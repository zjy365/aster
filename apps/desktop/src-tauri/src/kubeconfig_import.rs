//! Paste-to-import for kubeconfigs. The renderer hands the pasted text to the
//! shell (one-way; contents are never returned), which writes it into an
//! app-managed directory next to `config.yaml` and returns the path so it can
//! be added as a kubeconfig source like any picked file.
//!
//! This deliberately amends the "kubeconfig contents are never copied" stance
//! noted in settings.rs: pasted configs exist only as text in the renderer, so
//! importing means copying them into a managed file (mode 0600). Files under
//! the managed directory are owned by the app — they are pruned when an apply
//! leaves them unreferenced.

use std::fs;
use std::path::{Path, PathBuf};

/// Kubeconfigs are small; the cap rejects accidents (whole directories of
/// YAML, a binary paste) before they touch the disk.
pub const MAX_CONTENT_BYTES: usize = 1 << 20;

/// XDG-aware base for Aster's config files; shared with SettingsFile.
pub fn config_base_dir() -> PathBuf {
    std::env::var("XDG_CONFIG_HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".config"))
        .join("aster")
}

pub fn managed_kubeconfig_dir() -> PathBuf {
    config_base_dir().join("kubeconfigs")
}

/// Lightweight structural sniff. The Go core remains the authoritative
/// validator (it re-parses every source on load and reports errors per
/// source); this only keeps obvious non-kubeconfigs from ever hitting the
/// disk, with errors specific enough to fix the paste. Returns the first
/// context name found, used as the default file slug.
pub fn sniff_kubeconfig(content: &str) -> Result<String, String> {
    if content.len() > MAX_CONTENT_BYTES {
        return Err(format!("content exceeds the {} KiB limit", MAX_CONTENT_BYTES / 1024));
    }
    if content.trim().is_empty() {
        return Err("nothing pasted".to_string());
    }
    if content.contains('\t') {
        // YAML forbids tabs for indentation; a tabbed paste is always a copy
        // artifact, so name it instead of failing later in the core.
        return Err("the pasted text contains tab characters, which YAML forbids".to_string());
    }

    let mut has_api_version = false;
    let mut has_kind_config = false;
    let mut in_contexts = false;
    let mut first_context: Option<String> = None;
    let mut contexts_seen = 0usize;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        // Block sequences may sit at column 0 under their key (that is how
        // kubectl writes them), so a `- ` line never ends the contexts block.
        let top_level = !line.starts_with(char::is_whitespace) && !trimmed.starts_with("- ");
        if top_level {
            in_contexts = false;
            if trimmed.starts_with("apiVersion:") {
                has_api_version = true;
                continue;
            }
            if let Some(value) = trimmed.strip_prefix("kind:") {
                if value.trim().trim_matches(|c| c == '"' || c == '\'') == "Config" {
                    has_kind_config = true;
                }
                continue;
            }
            if let Some(rest) = trimmed.strip_prefix("contexts:") {
                let rest = rest.trim();
                if rest.is_empty() {
                    in_contexts = true;
                } else if rest != "[]" {
                    // Inline list form (`contexts: [{...}]`) is valid YAML but
                    // never emitted by tooling; accept it without parsing.
                    contexts_seen += 1;
                }
                continue;
            }
            continue;
        }
        if in_contexts && trimmed.starts_with("- ") {
            contexts_seen += 1;
            if first_context.is_none() {
                if let Some(value) = trimmed.strip_prefix("- name:") {
                    let name = value.trim().trim_matches(|c| c == '"' || c == '\'');
                    if !name.is_empty() {
                        first_context = Some(name.to_string());
                    }
                }
            }
        }
    }

    if !has_api_version || !has_kind_config {
        return Err("the pasted text does not look like a kubeconfig (missing apiVersion/kind: Config)".to_string());
    }
    if contexts_seen == 0 {
        return Err("no contexts found in the pasted kubeconfig".to_string());
    }
    Ok(first_context.unwrap_or_default())
}

/// Filesystem-safe slug for the managed file name. Empty input falls back to
/// a generic stem so an unnamed paste still lands somewhere readable.
pub fn slugify(name: &str) -> String {
    let mut slug = String::with_capacity(name.len());
    let mut last_dash = false;
    for ch in name.trim().chars().flat_map(char::to_lowercase) {
        let keep = ch.is_ascii_alphanumeric() || ch == '_' || ch == '-';
        if keep {
            slug.push(ch);
            last_dash = false;
        } else if !last_dash && !slug.is_empty() {
            slug.push('-');
            last_dash = true;
        }
    }
    let slug = slug.trim_end_matches('-');
    let mut slug = if slug.is_empty() { "cluster".to_string() } else { slug.to_string() };
    slug.truncate(64);
    slug
}

/// First free path for `slug` inside `dir`: `<slug>.yaml`, then `-2`, `-3`…
fn unique_path(dir: &Path, slug: &str) -> PathBuf {
    for suffix in 1.. {
        let stem = if suffix == 1 { slug.to_string() } else { format!("{slug}-{suffix}") };
        let candidate = dir.join(format!("{stem}.yaml"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

/// Writes `content` into `dir` with owner-only permissions, atomically
/// (temp file + rename, same pattern as the settings file). Re-pasting the
/// exact same content returns the existing file instead of accumulating
/// duplicates. Returns the final path.
pub fn write_managed(dir: &Path, slug: &str, content: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|error| format!("cannot create {}: {error}", dir.display()))?;

    // Content dedupe: the managed dir holds only files we wrote, so scanning
    // it is bounded by our own 1 MiB cap per file and 64-source settings cap.
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("yaml") {
                continue;
            }
            if fs::read_to_string(&path).map(|existing| existing == content).unwrap_or(false) {
                return Ok(path);
            }
        }
    }

    let target = unique_path(dir, slug);
    let tmp = dir.join(format!(".{}.tmp", target.file_name().unwrap_or_default().to_string_lossy()));
    write_owner_only(&tmp, content.as_bytes()).map_err(|error| format!("cannot write {}: {error}", target.display()))?;
    fs::rename(&tmp, &target).map_err(|error| format!("cannot write {}: {error}", target.display()))?;
    Ok(target)
}

#[cfg(unix)]
fn write_owner_only(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(path)?;
    file.write_all(bytes)
}

#[cfg(not(unix))]
fn write_owner_only(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    fs::write(path, bytes)
}

/// Deletes managed files that no longer appear in `sources`. Called on apply
/// so a removed source does not leave an orphaned credential file behind.
/// Only files inside `dir` are ever touched; best-effort per file.
pub fn prune_unreferenced(dir: &Path, sources: &[String]) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("yaml") {
            continue;
        }
        let referenced = sources.iter().any(|source| Path::new(source) == path);
        if !referenced {
            let _ = fs::remove_file(&path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "apiVersion: v1\nkind: Config\nclusters:\n- name: dev\n  cluster:\n    server: https://dev.example\ncontexts:\n- name: dev-admin\n  context:\n    cluster: dev\n    user: dev\ncurrent-context: dev-admin\nusers:\n- name: dev\n  user:\n    token: abc\n";

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aster-import-test-{}-{}", std::process::id(), tag));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sniff_accepts_a_typical_kubeconfig_and_extracts_first_context() {
        assert_eq!(sniff_kubeconfig(SAMPLE).unwrap(), "dev-admin");
        // Indented sequence entries work too.
        let indented = SAMPLE.replace("\n- name:", "\n  - name:");
        assert_eq!(sniff_kubeconfig(&indented).unwrap(), "dev-admin");
    }

    #[test]
    fn sniff_rejects_empty_oversized_and_non_kubeconfig_text() {
        assert!(sniff_kubeconfig("   \n").unwrap_err().contains("nothing pasted"));
        assert!(sniff_kubeconfig(&"x".repeat(MAX_CONTENT_BYTES + 1)).unwrap_err().contains("limit"));
        assert!(sniff_kubeconfig("foo: bar\n").unwrap_err().contains("does not look like a kubeconfig"));
        assert!(sniff_kubeconfig("apiVersion: v1\nkind: Pod\nmetadata:\n  name: x\n").unwrap_err().contains("does not look like a kubeconfig"));
    }

    #[test]
    fn sniff_requires_at_least_one_context() {
        let doc = "apiVersion: v1\nkind: Config\nclusters:\n- name: dev\n  cluster:\n    server: https://dev.example\n";
        assert_eq!(sniff_kubeconfig(doc).unwrap_err(), "no contexts found in the pasted kubeconfig");
        let empty_inline = "apiVersion: v1\nkind: Config\ncontexts: []\n";
        assert_eq!(sniff_kubeconfig(empty_inline).unwrap_err(), "no contexts found in the pasted kubeconfig");
        let inline = "apiVersion: v1\nkind: Config\ncontexts: [{name: dev}]\n";
        assert!(sniff_kubeconfig(inline).is_ok());
    }

    #[test]
    fn sniff_rejects_tabs() {
        let doc = "apiVersion: v1\nkind: Config\ncontexts:\n\t- name: dev\n";
        assert!(sniff_kubeconfig(doc).unwrap_err().contains("tab"));
    }

    #[test]
    fn slugify_normalizes_and_falls_back() {
        assert_eq!(slugify("Prod Admin (EU)"), "prod-admin-eu");
        assert_eq!(slugify("  ***  "), "cluster");
        assert_eq!(slugify("already_fine-1"), "already_fine-1");
        assert_eq!(slugify(&"a".repeat(100)).len(), 64);
    }

    #[test]
    fn write_managed_creates_0600_file_and_suffixes_collisions() {
        let dir = temp_dir("write");
        let first = write_managed(&dir, "dev", SAMPLE).unwrap();
        assert_eq!(first, dir.join("dev.yaml"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&first).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let second = write_managed(&dir, "dev", "apiVersion: v1\nkind: Config\ncontexts:\n- name: other\n").unwrap();
        assert_eq!(second, dir.join("dev-2.yaml"));
    }

    #[test]
    fn write_managed_dedupes_identical_content() {
        let dir = temp_dir("dedupe");
        let first = write_managed(&dir, "dev", SAMPLE).unwrap();
        let again = write_managed(&dir, "dev", SAMPLE).unwrap();
        assert_eq!(first, again);
        assert_eq!(fs::read_dir(&dir).unwrap().filter(|e| e.as_ref().unwrap().path().extension().and_then(|x| x.to_str()) == Some("yaml")).count(), 1);
    }

    #[test]
    fn prune_removes_only_unreferenced_managed_yaml() {
        let dir = temp_dir("prune");
        let keep = write_managed(&dir, "keep", SAMPLE).unwrap();
        let drop = write_managed(&dir, "drop", "apiVersion: v1\nkind: Config\ncontexts:\n- name: x\n").unwrap();
        let outside = temp_dir("prune-outside").join("outside.yaml");
        fs::write(&outside, SAMPLE).unwrap();
        fs::write(dir.join("notes.txt"), "not a kubeconfig").unwrap();

        prune_unreferenced(&dir, &[keep.to_string_lossy().into_owned(), outside.to_string_lossy().into_owned()]);

        assert!(keep.exists());
        assert!(!drop.exists());
        assert!(outside.exists(), "prune must never touch files outside the managed dir");
        assert!(dir.join("notes.txt").exists());
    }
}
