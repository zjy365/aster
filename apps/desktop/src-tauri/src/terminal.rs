//! One-click handoff from the workbench to the user's own terminal: stage a
//! single-context kubeconfig in a 0600 temp file, then open the user's
//! terminal with `KUBECONFIG` pointing at it and an interactive shell.
//!
//! Credential rules (aster is credential-careful):
//!   - the staged kubeconfig is mode 0600 inside a 0700 app cache directory;
//!   - its path and contents are never logged and never returned to the
//!     renderer — the renderer only sends the context id;
//!   - registered files are deleted when the app exits (plus a startup sweep
//!     of leftovers from crashed runs);
//!   - the launch is fire-and-forget: stdin/stdout/stderr are /dev/null, so
//!     no terminal output ever flows back into aster;
//!   - no kubectl wrapping: the user runs their own kubectl against the
//!     exported environment. Nothing is installed or downloaded.
//!
//! macOS only in this release; Windows and Linux are explicit non-goals.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;

use rand::distributions::Alphanumeric;
use rand::Rng;

/// Terminals we can hand off to, in preference order.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TerminalKind {
    Iterm2,
    WezTerm,
    Kitty,
    Ghostty,
    AppleTerminal,
}

/// A detected terminal and how to invoke it. `program` is a terminal CLI
/// resolved from PATH or an app-bundle binary path; iTerm2 and Terminal.app
/// are driven through the system helpers osascript/open.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TerminalSpec {
    pub kind: TerminalKind,
    pub program: String,
}

/// Where detection looks: app-bundle roots and the PATH directories.
/// Injectable so tests can stage fake bundles and binaries.
pub struct TerminalPaths {
    pub app_roots: Vec<PathBuf>,
    pub path_dirs: Vec<PathBuf>,
}

impl TerminalPaths {
    /// macOS-flavoured defaults; harmless (never matching) elsewhere, which
    /// the platform guard in `open_kubectl` already rejects before use.
    pub fn from_system() -> Self {
        let mut app_roots = vec![PathBuf::from("/Applications"), PathBuf::from("/System/Applications")];
        if let Some(home) = dirs::home_dir() {
            app_roots.push(home.join("Applications"));
        }
        let path_dirs = std::env::var_os("PATH")
            .map(|value| std::env::split_paths(&value).collect())
            .unwrap_or_default();
        Self { app_roots, path_dirs }
    }

    fn bundle_exists(&self, relative: &str) -> bool {
        self.app_roots.iter().any(|root| root.join(relative).exists())
    }

    fn binary_in_path(&self, name: &str) -> Option<String> {
        self.path_dirs
            .iter()
            .map(|dir| dir.join(name))
            .find(|path| is_executable(path))
            .map(|path| path.to_string_lossy().into_owned())
    }

    /// The multi-call CLI inside an installed bundle (wezterm/kitty/ghostty
    /// all ship their CLI as the bundle executable).
    fn bundle_binary(&self, bundle: &str, cli: &str) -> Option<String> {
        self.app_roots
            .iter()
            .map(|root| root.join(bundle).join("Contents").join("MacOS").join(cli))
            .find(|path| is_executable(path))
            .map(|path| path.to_string_lossy().into_owned())
    }
}

fn is_executable(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else { return false };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Picks the first terminal that is actually installed. iTerm2 is detected by
/// its app bundle (or its it2cli utility on PATH); WezTerm, Kitty and Ghostty
/// by their CLI on PATH or their app bundle; Terminal.app is the always-there
/// fallback.
pub fn detect_terminal(paths: &TerminalPaths) -> Option<TerminalSpec> {
    if paths.bundle_exists("iTerm.app") || paths.binary_in_path("it2cli").is_some() {
        return Some(TerminalSpec { kind: TerminalKind::Iterm2, program: "/usr/bin/osascript".into() });
    }
    if let Some(program) = paths.binary_in_path("wezterm").or_else(|| paths.bundle_binary("WezTerm.app", "wezterm")) {
        return Some(TerminalSpec { kind: TerminalKind::WezTerm, program });
    }
    if let Some(program) = paths.binary_in_path("kitty").or_else(|| paths.bundle_binary("kitty.app", "kitty")) {
        return Some(TerminalSpec { kind: TerminalKind::Kitty, program });
    }
    if let Some(program) = paths.binary_in_path("ghostty").or_else(|| paths.bundle_binary("Ghostty.app", "ghostty")) {
        return Some(TerminalSpec { kind: TerminalKind::Ghostty, program });
    }
    if paths.bundle_exists("Utilities/Terminal.app") {
        return Some(TerminalSpec { kind: TerminalKind::AppleTerminal, program: "/usr/bin/open".into() });
    }
    None
}

/// Single-quote for POSIX shells. Every byte between the quotes is literal,
/// so a hostile context name can never break out of the string.
fn shell_quote(value: &str) -> String {
    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('\'');
    for ch in value.chars() {
        if ch == '\'' {
            quoted.push_str("'\\''");
        } else {
            quoted.push(ch);
        }
    }
    quoted.push('\'');
    quoted
}

/// Escapes a value for an AppleScript string literal (backslash and quote).
fn applescript_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

/// The shell code the new terminal window runs: point KUBECONFIG at the staged
/// file, print the handoff banner, then replace the interpreter with the
/// user's login shell so the window stays interactive. One line, because
/// iTerm2's AppleScript takes the whole snippet as one command string.
fn session_snippet(kubeconfig: &Path, context_name: &str) -> String {
    format!(
        "export KUBECONFIG={}; printf '\\n  aster \u{25CF} context: %s\\n\\n' {}; exec \"${{SHELL:-/bin/zsh}}\"",
        shell_quote(&kubeconfig.to_string_lossy()),
        shell_quote(context_name),
    )
}

/// Full argv (program first) that opens a new window of `spec` running
/// `snippet`. `script` is the staged .command file and is used by Terminal.app
/// only — `open` hands the file to Terminal, which executes it in a window.
fn launch_argv(spec: &TerminalSpec, snippet: &str, script: Option<&Path>) -> Vec<String> {
    let program = spec.program.clone();
    match spec.kind {
        TerminalKind::Iterm2 => vec![
            program,
            "-e".into(),
            format!(
                "tell application id \"com.googlecode.iterm2\" to create window with default profile command \"{}\"",
                applescript_escape(snippet)
            ),
        ],
        TerminalKind::WezTerm => vec![
            program,
            "start".into(),
            "--always-new-process".into(),
            "--".into(),
            "/bin/sh".into(),
            "-c".into(),
            snippet.into(),
        ],
        TerminalKind::Kitty => vec![program, "/bin/sh".into(), "-c".into(), snippet.into()],
        TerminalKind::Ghostty => vec![program, "-e".into(), "/bin/sh".into(), "-c".into(), snippet.into()],
        TerminalKind::AppleTerminal => vec![
            program,
            "-a".into(),
            "Terminal".into(),
            script.map(|path| path.to_string_lossy().into_owned()).unwrap_or_default(),
        ],
    }
}

/// Fire-and-forget launch: the child inherits `KUBECONFIG` where the platform
/// passes env to GUI apps, nothing is piped back, and dropping the
/// std::process::Child handle never kills it.
fn spawn_detached(argv: &[String], kubeconfig: &Path) -> Result<(), String> {
    let (program, args) = argv.split_first().ok_or("empty terminal command")?;
    std::process::Command::new(program)
        .args(args)
        .env("KUBECONFIG", kubeconfig)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("cannot launch terminal: {error}"))
}

/// Registry of staged credential files. One instance lives in the app state;
/// `cleanup_all` runs on exit.
pub struct TempKubeconfigs {
    dir: PathBuf,
    registered: Mutex<Vec<PathBuf>>,
}

impl TempKubeconfigs {
    pub fn new() -> Self {
        Self::with_dir(default_dir())
    }

    pub fn with_dir(dir: PathBuf) -> Self {
        Self { dir, registered: Mutex::new(Vec::new()) }
    }

    /// The directory staged files live in (also the sweep target at startup).
    pub fn staging_dir(&self) -> PathBuf {
        self.dir.clone()
    }

    /// Writes an exported kubeconfig into the cache dir as a fresh 0600 file
    /// and registers it for exit cleanup.
    pub fn stage_kubeconfig(&self, contents: &str) -> Result<PathBuf, String> {
        self.stage(contents, "kubeconfig", 0o600)
    }

    /// Writes the Terminal.app launcher script (0700 so the shell can run it).
    pub fn stage_script(&self, snippet: &str) -> Result<PathBuf, String> {
        self.stage(&format!("#!/bin/sh\n{snippet}\n"), "command", 0o700)
    }

    fn stage(&self, contents: &str, extension: &str, mode: u32) -> Result<PathBuf, String> {
        fs::create_dir_all(&self.dir).map_err(|error| format!("cannot create {}: {error}", self.dir.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            // Best effort: existing directories keep whatever they already had.
            let _ = fs::set_permissions(&self.dir, fs::Permissions::from_mode(0o700));
        }
        // Fresh name per stage; a collision loops a few times at most.
        for _ in 0..8 {
            let name: String = rand::thread_rng()
                .sample_iter(&Alphanumeric)
                .take(16)
                .map(char::from)
                .collect();
            let path = self.dir.join(format!("{name}.{extension}"));
            match write_new_file(&path, contents.as_bytes(), mode) {
                Ok(()) => {
                    self.registered.lock().expect("kubeconfig registry poisoned").push(path.clone());
                    return Ok(path);
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("cannot write {}: {error}", path.display())),
            }
        }
        Err("could not allocate a staging file name".to_string())
    }

    /// Deletes every registered file. Called once on app exit; per-file
    /// failures are ignored — the startup sweep is the backstop.
    pub fn cleanup_all(&self) {
        let paths: Vec<PathBuf> = self.registered.lock().expect("kubeconfig registry poisoned").drain(..).collect();
        for path in paths {
            let _ = fs::remove_file(&path);
        }
    }

    /// The full handoff as an app-state service: stage the exported
    /// kubeconfig, then open the user's terminal with a banner and an
    /// interactive shell. The YAML is the core's export for exactly one
    /// context; it never crosses into the renderer and is never logged.
    pub async fn open_kubectl(&self, context_name: &str, kubeconfig_yaml: &str) -> Result<(), String> {
        open_kubectl(self, context_name, kubeconfig_yaml).await
    }
}

impl Default for TempKubeconfigs {
    fn default() -> Self {
        Self::new()
    }
}

/// `~/.cache`-equivalent app cache dir (on macOS `~/Library/Caches/aster`).
fn default_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("aster")
        .join("kubectl")
}

fn write_new_file(path: &Path, bytes: &[u8], mode: u32) -> std::io::Result<()> {
    use std::io::Write;
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = fs::OpenOptions::new().write(true).create_new(true).mode(mode).open(path)?;
        file.write_all(bytes)
    }
    #[cfg(not(unix))]
    {
        let _ = mode;
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(path)?;
        file.write_all(bytes)
    }
}

/// Deletes staged leftovers from previous runs that crashed before cleanup.
/// Only files matching our staging extensions are considered, and only ones
/// older than `older_than`, so a terminal session opened moments ago (even by
/// a previous instance) keeps its credentials.
pub fn sweep_stale(dir: &Path, older_than: Duration) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if !(name.ends_with(".kubeconfig") || name.ends_with(".command")) {
            continue;
        }
        let Ok(modified) = entry.metadata().and_then(|meta| meta.modified()) else { continue };
        let Ok(age) = modified.elapsed() else { continue };
        if age >= older_than {
            let _ = fs::remove_file(&path);
        }
    }
}

/// Probes for a usable local kubectl (`kubectl version --client`, bounded so a
/// hung binary cannot stall the caller). Used to disable the UI action; never
/// installs or downloads anything.
pub async fn kubectl_available() -> bool {
    let mut command = tokio::process::Command::new("kubectl");
    command
        .args(["version", "--client"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    match tokio::time::timeout(Duration::from_secs(5), command.status()).await {
        Ok(Ok(status)) => status.success(),
        _ => false,
    }
}

/// The scope guard: this handoff exists on macOS only in this release.
fn ensure_supported_platform() -> Result<(), String> {
    if cfg!(target_os = "macos") {
        Ok(())
    } else {
        Err("Open kubectl here is available on macOS only in this release".to_string())
    }
}

/// The full handoff: stage the exported kubeconfig, then open the user's
/// terminal with a banner and an interactive shell. The kubeconfig argument is
/// the core's exported YAML for exactly one context; it never crosses into
/// the renderer and is never logged.
pub async fn open_kubectl(registry: &TempKubeconfigs, context_name: &str, kubeconfig_yaml: &str) -> Result<(), String> {
    ensure_supported_platform()?;
    let paths = TerminalPaths::from_system();
    let spec = detect_terminal(&paths)
        .ok_or_else(|| "no supported terminal found (looked for iTerm2, WezTerm, Kitty, Ghostty, Terminal.app)".to_string())?;
    let kubeconfig = registry.stage_kubeconfig(kubeconfig_yaml)?;
    let snippet = session_snippet(&kubeconfig, context_name);
    // Terminal.app runs a staged .command file instead of a -c command string.
    let script = (spec.kind == TerminalKind::AppleTerminal)
        .then(|| registry.stage_script(&snippet))
        .transpose()?;
    let argv = launch_argv(&spec, &snippet, script.as_deref());
    spawn_detached(&argv, &kubeconfig)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aster-terminal-test-{}-{}", std::process::id(), tag));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_executable(path: &Path) {
        fs::write(path, b"#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    /// Stages app bundles under one fake root and CLI binaries under one fake
    /// PATH dir; plus a non-executable decoy that must never count. Each call
    /// gets a fresh directory — tests run in parallel.
    fn fixture_paths(bundles: &[(&str, Option<&str>)], binaries: &[&str]) -> TerminalPaths {
        static SEQUENCE: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let unique = SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let base = temp_dir(&format!("detect-{unique}"));
        let apps = base.join("apps");
        let bin = base.join("bin");
        fs::create_dir_all(&apps).unwrap();
        fs::create_dir_all(&bin).unwrap();
        for (bundle, cli) in bundles {
            // The bundle directory itself is enough for existence detection;
            // an inner CLI also makes the bundle-binary path resolvable.
            if let Some(cli) = cli {
                let executable = apps.join(bundle).join("Contents").join("MacOS").join(cli);
                fs::create_dir_all(executable.parent().unwrap()).unwrap();
                make_executable(&executable);
            } else {
                fs::create_dir_all(apps.join(bundle)).unwrap();
            }
        }
        for name in binaries {
            make_executable(&bin.join(name));
        }
        fs::write(bin.join("decoy"), b"not executable").unwrap();
        TerminalPaths { app_roots: vec![apps], path_dirs: vec![bin] }
    }

    #[test]
    fn detection_prefers_iterm_then_wezterm_kitty_ghostty_terminal() {
        let everything = fixture_paths(
            &[("iTerm.app", None), ("WezTerm.app", Some("wezterm")), ("kitty.app", Some("kitty")), ("Ghostty.app", Some("ghostty")), ("Utilities/Terminal.app", None)],
            &["wezterm", "kitty", "ghostty"],
        );
        assert_eq!(detect_terminal(&everything).unwrap().kind, TerminalKind::Iterm2);

        let no_iterm = fixture_paths(
            &[("WezTerm.app", Some("wezterm")), ("kitty.app", Some("kitty")), ("Ghostty.app", Some("ghostty")), ("Utilities/Terminal.app", None)],
            &["wezterm", "kitty", "ghostty"],
        );
        assert_eq!(detect_terminal(&no_iterm).unwrap().kind, TerminalKind::WezTerm);

        let no_wezterm = fixture_paths(
            &[("kitty.app", Some("kitty")), ("Ghostty.app", Some("ghostty")), ("Utilities/Terminal.app", None)],
            &["kitty", "ghostty"],
        );
        assert_eq!(detect_terminal(&no_wezterm).unwrap().kind, TerminalKind::Kitty);

        let no_kitty = fixture_paths(&[("Ghostty.app", Some("ghostty")), ("Utilities/Terminal.app", None)], &["ghostty"]);
        assert_eq!(detect_terminal(&no_kitty).unwrap().kind, TerminalKind::Ghostty);

        let bare = fixture_paths(&[("Utilities/Terminal.app", None)], &[]);
        assert_eq!(detect_terminal(&bare).unwrap().kind, TerminalKind::AppleTerminal);

        let nothing = fixture_paths(&[], &[]);
        assert_eq!(detect_terminal(&nothing), None);
    }

    #[test]
    fn detection_resolves_path_cli_and_bundle_cli_programs() {
        // Only the wezterm CLI on PATH, no bundles: invoke it by name.
        let cli_only = fixture_paths(&[("Utilities/Terminal.app", None)], &["wezterm"]);
        let spec = detect_terminal(&cli_only).unwrap();
        assert_eq!(spec.kind, TerminalKind::WezTerm);
        assert!(spec.program.ends_with("wezterm"), "program = {}", spec.program);

        // Only the app bundle, nothing on PATH: the bundle's CLI binary runs.
        let bundle_only = fixture_paths(&[("WezTerm.app", Some("wezterm")), ("Utilities/Terminal.app", None)], &[]);
        let spec = detect_terminal(&bundle_only).unwrap();
        assert_eq!(spec.kind, TerminalKind::WezTerm);
        assert!(spec.program.contains("WezTerm.app/Contents/MacOS/wezterm"), "program = {}", spec.program);
    }

    #[test]
    fn detection_accepts_it2cli_as_an_iterm_signal() {
        let it2cli = fixture_paths(&[("Utilities/Terminal.app", None)], &["it2cli"]);
        assert_eq!(detect_terminal(&it2cli).unwrap().kind, TerminalKind::Iterm2);
    }

    #[test]
    fn shell_quote_neutralizes_hostile_input() {
        assert_eq!(shell_quote("plain"), "'plain'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
        let hostile = "'; rm -rf ~; echo \"$(whoami)\"";
        let quoted = shell_quote(hostile);
        // Every single quote inside must be closed by the escape sequence, so
        // nothing between the outer quotes is ever interpreted by the shell.
        assert!(quoted.starts_with('\'') && quoted.ends_with('\''), "{quoted}");
        assert!(quoted.contains("'\\''; rm -rf ~"), "{quoted}");
    }

    #[test]
    fn session_snippet_exports_kubeconfig_and_execs_login_shell() {
        let snippet = session_snippet(Path::new("/tmp/staged/config.yaml"), "dev \"ops\"");
        assert!(snippet.contains("export KUBECONFIG='/tmp/staged/config.yaml'"), "{snippet}");
        assert!(snippet.contains("aster \u{25CF} context: %s"), "{snippet}");
        // The context name is inert inside single quotes.
        assert!(snippet.contains("'dev \"ops\"'"), "{snippet}");
        assert!(snippet.contains("exec \"${SHELL:-/bin/zsh}\""), "{snippet}");
        assert!(!snippet.contains('\n'), "snippet must stay one line for AppleScript: {snippet}");
    }

    #[test]
    fn launch_argv_shapes_match_each_terminal() {
        let kube = Path::new("/staged/x.kubeconfig");
        let snippet = session_snippet(kube, "dev");

        let wezterm = launch_argv(&TerminalSpec { kind: TerminalKind::WezTerm, program: "wezterm".into() }, &snippet, None);
        assert_eq!(wezterm.iter().map(String::as_str).collect::<Vec<_>>()[..5], ["wezterm", "start", "--always-new-process", "--", "/bin/sh"]);
        assert_eq!(wezterm.last().unwrap(), &snippet);

        let kitty = launch_argv(&TerminalSpec { kind: TerminalKind::Kitty, program: "kitty".into() }, &snippet, None);
        assert_eq!(kitty.iter().map(String::as_str).collect::<Vec<_>>(), ["kitty", "/bin/sh", "-c", &snippet]);

        let ghostty = launch_argv(&TerminalSpec { kind: TerminalKind::Ghostty, program: "ghostty".into() }, &snippet, None);
        assert_eq!(ghostty.iter().map(String::as_str).collect::<Vec<_>>(), ["ghostty", "-e", "/bin/sh", "-c", &snippet]);

        let iterm = launch_argv(&TerminalSpec { kind: TerminalKind::Iterm2, program: "/usr/bin/osascript".into() }, &snippet, None);
        assert_eq!(iterm.iter().map(String::as_str).collect::<Vec<_>>()[..2], ["/usr/bin/osascript", "-e"]);
        let apple_script = &iterm[2];
        assert!(apple_script.contains("com.googlecode.iterm2"), "{apple_script}");
        assert!(apple_script.contains("create window with default profile command"), "{apple_script}");

        let terminal_app = launch_argv(
            &TerminalSpec { kind: TerminalKind::AppleTerminal, program: "/usr/bin/open".into() },
            &snippet,
            Some(Path::new("/staged/y.command")),
        );
        assert_eq!(
            terminal_app.iter().map(String::as_str).collect::<Vec<_>>(),
            ["/usr/bin/open", "-a", "Terminal", "/staged/y.command"]
        );
    }

    #[test]
    fn applescript_escape_escapes_backslash_and_quote() {
        assert_eq!(applescript_escape("a\"b\\c"), "a\\\"b\\\\c");
        // A snippet carrying shell single-quotes survives unchanged.
        assert_eq!(applescript_escape("'quoted'"), "'quoted'");
    }

    #[test]
    fn staged_kubeconfig_is_0600_and_cleaned_up_on_exit() {
        let dir = temp_dir("lifecycle");
        let registry = TempKubeconfigs::with_dir(dir.clone());
        let first = registry.stage_kubeconfig("apiVersion: v1\nkind: Config\n").unwrap();
        let second = registry.stage_kubeconfig("apiVersion: v1\nkind: Config\n").unwrap();
        assert_ne!(first, second, "each stage allocates a fresh file");
        assert_eq!(first.extension().unwrap(), "kubeconfig");
        assert_eq!(fs::read_to_string(&first).unwrap(), "apiVersion: v1\nkind: Config\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&first).unwrap().permissions().mode() & 0o777, 0o600);
            assert_eq!(fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
        }

        registry.cleanup_all();
        assert!(!first.exists());
        assert!(!second.exists());
        // Idempotent: a second cleanup after staging nothing stays quiet.
        registry.cleanup_all();
    }

    #[test]
    fn staged_script_is_executable_and_wraps_the_snippet() {
        let registry = TempKubeconfigs::with_dir(temp_dir("script"));
        let path = registry.stage_script("echo hi").unwrap();
        let contents = fs::read_to_string(&path).unwrap();
        assert!(contents.starts_with("#!/bin/sh\n"), "{contents}");
        assert!(contents.contains("echo hi"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o700);
        }
    }

    #[test]
    fn sweep_removes_only_stale_staged_files() {
        let dir = temp_dir("sweep");
        let stale_kubeconfig = dir.join("stale.kubeconfig");
        let fresh_kubeconfig = dir.join("fresh.kubeconfig");
        let stale_command = dir.join("stale.command");
        let foreign = dir.join("notes.txt");
        for path in [&stale_kubeconfig, &fresh_kubeconfig, &stale_command] {
            fs::write(path, "x").unwrap();
        }
        fs::write(&foreign, "x").unwrap();

        let stale = std::time::SystemTime::now() - Duration::from_secs(48 * 60 * 60);
        for path in [&stale_kubeconfig, &stale_command] {
            set_modified(path, stale);
        }

        sweep_stale(&dir, Duration::from_secs(24 * 60 * 60));
        assert!(!stale_kubeconfig.exists(), "stale staged kubeconfigs must go");
        assert!(!stale_command.exists(), "stale launcher scripts must go");
        assert!(fresh_kubeconfig.exists(), "fresh staged files must survive");
        assert!(foreign.exists(), "foreign files must never be touched");
    }

    #[cfg(unix)]
    fn set_modified(path: &Path, time: std::time::SystemTime) {
        let file = fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_times(std::fs::FileTimes::new().set_modified(time)).unwrap();
    }

    #[cfg(not(unix))]
    fn set_modified(_path: &Path, _time: std::time::SystemTime) {}

    #[test]
    fn platform_guard_names_the_macos_scope() {
        if cfg!(target_os = "macos") {
            assert_eq!(ensure_supported_platform(), Ok(()));
        } else {
            assert!(ensure_supported_platform().unwrap_err().contains("macOS only"));
        }
    }

    #[tokio::test]
    async fn kubectl_probe_treats_a_missing_binary_as_unavailable() {
        // PATH with no kubectl: the spawn must error (not hang) and map to
        // the same false the probe reports.
        let mut command = tokio::process::Command::new("definitely-not-a-real-kubectl-binary");
        command
            .args(["version", "--client"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let outcome = tokio::time::timeout(Duration::from_secs(5), command.status()).await;
        assert!(matches!(outcome, Ok(Err(_))), "spawning a missing binary must error, got {outcome:?}");
    }
}
