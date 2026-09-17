use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;

/// Application settings on disk (~/.config/aster/config.yaml, honoring
/// XDG_CONFIG_HOME). Port of src/main/settings.ts: the schema is a strict
/// whitelist and kubeconfig sources are path references — file contents
/// never enter the renderer. One exception: paste-imported kubeconfigs are
/// copied into an app-managed directory by design (see kubeconfig_import.rs).
const MAX_SOURCES: usize = 64;
const MAX_PATH_LENGTH: usize = 2048;
/// Defensive bound on the alias section so a hand-grown or corrupted file
/// cannot balloon the settings document.
const MAX_ALIASES: usize = 512;
/// Context ids (kubeconfig context names) can be long — EKS ARNs reach ~80
/// chars — but nowhere near this; the cap only stops abuse.
const MAX_CONTEXT_ID_LENGTH: usize = 512;
pub const MAX_ALIAS_LENGTH: usize = 64;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AsterSettings {
    pub kubeconfig_sources: Vec<String>,
    /// The standard chain ($KUBECONFIG + ~/.kube/config) participates unless
    /// the user turns it off. It is a default, not a privilege: with it off
    /// and no configured sources the app simply has no clusters.
    pub include_standard_chain: bool,
    /// RFC 3339 timestamp written when the first-run welcome card is dismissed.
    /// Absent means never welcomed. The shell only stores it — deciding when
    /// the card shows is the renderer's.
    pub welcomed_at: Option<String>,
    /// Display aliases for kubeconfig contexts, keyed by context id (the
    /// kubeconfig context name). Purely cosmetic — the kubeconfig files are
    /// never rewritten for a rename. Entries for contexts that no longer
    /// exist are kept: an alias returns when its context does.
    pub context_aliases: BTreeMap<String, String>,
}

impl Default for AsterSettings {
    fn default() -> Self {
        Self {
            kubeconfig_sources: Vec::new(),
            include_standard_chain: true,
            welcomed_at: None,
            context_aliases: BTreeMap::new(),
        }
    }
}

pub struct SettingsFile {
    path: PathBuf,
    lock: Mutex<()>,
}

impl SettingsFile {
    pub fn new(path: PathBuf) -> Self {
        Self { path, lock: Mutex::new(()) }
    }

    pub fn default_path() -> Self {
        Self::new(crate::kubeconfig_import::config_base_dir().join("config.yaml"))
    }

    pub fn read(&self) -> AsterSettings {
        fs::read_to_string(&self.path)
            .map(|document| parse_settings(&document))
            .unwrap_or_default()
    }

    pub fn write(&self, settings: &AsterSettings) {
        let _guard = self.lock.lock().unwrap();
        let Some(directory) = self.path.parent() else { return };
        if fs::create_dir_all(directory).is_err() {
            return;
        }
        let file_name = self.path.file_name().unwrap_or_default().to_string_lossy();
        let target = directory.join(format!(".{file_name}.tmp"));
        if fs::write(&target, serialize_settings(settings)).is_ok() {
            let _ = fs::rename(&target, &self.path);
        }
    }

    /// Stamps the welcome time if absent and persists it. Idempotent: an
    /// existing stamp is kept, so repeated dismisses never move it.
    pub fn mark_welcomed_with(&self, stamp: &str) -> AsterSettings {
        let mut settings = self.read();
        if settings.welcomed_at.is_none() {
            settings.welcomed_at = Some(stamp.to_string());
            self.write(&settings);
        }
        settings
    }

    /// Sets one context's display alias, or removes it when `alias` normalizes
    /// to nothing (None, blank, or overlong). Unrelated fields carry forward.
    pub fn set_context_alias(&self, context_id: &str, alias: Option<&str>) -> AsterSettings {
        let mut settings = self.read();
        let id = context_id.trim();
        if !id.is_empty() && id.len() <= MAX_CONTEXT_ID_LENGTH {
            match normalize_alias(alias) {
                Some(value) => {
                    settings.context_aliases.insert(id.to_string(), value);
                }
                None => {
                    settings.context_aliases.remove(id);
                }
            }
            self.write(&settings);
        }
        settings
    }
}

/// Parses the settings document; unknown keys are dropped, not merged.
pub fn parse_settings(document: &str) -> AsterSettings {
    let mut sources: Vec<String> = Vec::new();
    // Absent means true, so settings files written by older versions keep
    // the chain.
    let mut include_standard_chain = true;
    let mut welcomed_at: Option<String> = None;
    let mut context_aliases: BTreeMap<String, String> = BTreeMap::new();
    let mut in_list = false;
    let mut in_aliases = false;
    for line in document.split('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("includeStandardChain:") {
            include_standard_chain = rest.trim() != "false";
            in_list = false;
            in_aliases = false;
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("welcomedAt:") {
            let value = unquote_yaml_string(rest.trim());
            welcomed_at = (!value.is_empty()).then_some(value);
            in_list = false;
            in_aliases = false;
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("kubeconfigSources:") {
            let rest = rest.trim();
            if rest.starts_with('[') && rest.ends_with(']') {
                let inner = &rest[1..rest.len() - 1];
                if !inner.trim().is_empty() {
                    for raw in inner.split(',') {
                        push_source(&mut sources, unquote_yaml_string(raw.trim()));
                    }
                }
                in_list = false;
            } else {
                in_list = rest.is_empty();
            }
            in_aliases = false;
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("contextAliases:") {
            // Only the block form carries entries; an inline "{}" (what the
            // serializer would write for empty) simply leaves the mode off.
            in_aliases = rest.trim().is_empty();
            in_list = false;
            continue;
        }
        if in_aliases {
            if let Some((key, value)) = parse_alias_entry(trimmed) {
                insert_alias(&mut context_aliases, key, value);
                continue;
            }
            in_aliases = false;
        }
        if in_list {
            if let Some(item) = trimmed.strip_prefix('-') {
                let item = item.trim_start();
                if !item.is_empty() {
                    push_source(&mut sources, unquote_yaml_string(item));
                    continue;
                }
            }
        }
        in_list = false;
    }
    sources.truncate(MAX_SOURCES);
    AsterSettings { kubeconfig_sources: sources, include_standard_chain, welcomed_at, context_aliases }
}

pub fn serialize_settings(settings: &AsterSettings) -> String {
    // The chain flag is only written when off; its absence parses as on. The
    // welcomed stamp is only written when present; its absence parses as
    // never welcomed. Alias entries are only written when any exist, so
    // files from versions without them stay byte-identical.
    let mut output = String::new();
    if !settings.include_standard_chain {
        output.push_str("includeStandardChain: false\n");
    }
    if let Some(stamp) = &settings.welcomed_at {
        let quoted = serde_json::to_string(stamp).unwrap_or_else(|_| format!("\"{stamp}\""));
        output.push_str(&format!("welcomedAt: {quoted}\n"));
    }
    if settings.kubeconfig_sources.is_empty() {
        output.push_str("kubeconfigSources: []\n");
    } else {
        output.push_str("kubeconfigSources:\n");
        for source in &settings.kubeconfig_sources {
            let quoted = serde_json::to_string(source).unwrap_or_else(|_| format!("\"{source}\""));
            output.push_str(&format!("  - {quoted}\n"));
        }
    }
    if !settings.context_aliases.is_empty() {
        output.push_str("contextAliases:\n");
        for (key, value) in &settings.context_aliases {
            let quoted_key = serde_json::to_string(key).unwrap_or_else(|_| format!("\"{key}\""));
            let quoted_value = serde_json::to_string(value).unwrap_or_else(|_| format!("\"{value}\""));
            output.push_str(&format!("  {quoted_key}: {quoted_value}\n"));
        }
    }
    output
}

/// Normalizes an incoming source list from the renderer: trimmed, capped, deduped.
pub fn normalize_sources(input: Vec<String>) -> Vec<String> {
    let mut sources: Vec<String> = Vec::new();
    for raw in input {
        push_source(&mut sources, raw.trim().to_string());
    }
    sources.truncate(MAX_SOURCES);
    sources
}

fn push_source(sources: &mut Vec<String>, value: String) {
    if !value.is_empty() && value.len() <= MAX_PATH_LENGTH && !sources.contains(&value) {
        sources.push(value);
    }
}

/// Normalizes an incoming alias: trimmed, non-empty, within the length cap.
/// Everything else (None included) means "no alias".
pub fn normalize_alias(alias: Option<&str>) -> Option<String> {
    let value = alias?.trim().to_string();
    (!value.is_empty() && value.chars().count() <= MAX_ALIAS_LENGTH).then_some(value)
}

/// Parses one `key: value` alias entry. Quoted keys are required to express
/// context ids containing colons (AWS EKS names), so the divider for them is
/// the first unescaped closing quote, not the first colon; unquoted keys are
/// accepted leniently for hand-edited files.
fn parse_alias_entry(line: &str) -> Option<(String, String)> {
    if let Some(rest) = line.strip_prefix('"') {
        let end = closing_quote(rest)?;
        let quoted = format!("\"{}\"", &rest[..end]);
        let key = serde_json::from_str::<String>(&quoted).ok()?;
        let value = rest[end + 1..].strip_prefix(':')?.trim();
        return Some((key, alias_value(value)));
    }
    let (key, value) = line.split_once(':')?;
    let key = unquote_yaml_string(key.trim());
    (!key.is_empty()).then(|| (key, alias_value(value.trim())))
}

fn alias_value(value: &str) -> String {
    if value.starts_with('"') {
        serde_json::from_str::<String>(value).unwrap_or_else(|_| unquote_yaml_string(value))
    } else {
        unquote_yaml_string(value)
    }
}

/// Index of the first unescaped closing double quote, byte-wise.
fn closing_quote(text: &str) -> Option<usize> {
    let mut escaped = false;
    for (index, character) in text.char_indices() {
        if escaped {
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == '"' {
            return Some(index);
        }
    }
    None
}

fn insert_alias(aliases: &mut BTreeMap<String, String>, key: String, value: String) {
    // Empty keys and overlong values (hand-edited files) are dropped rather
    // than written back; the count cap mirrors MAX_SOURCES.
    if key.is_empty() || value.is_empty() || value.chars().count() > MAX_ALIAS_LENGTH {
        return;
    }
    if aliases.len() >= MAX_ALIASES && !aliases.contains_key(&key) {
        return;
    }
    aliases.insert(key, value);
}

fn unquote_yaml_string(value: &str) -> String {
    let bytes = value.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        return value[1..value.len() - 1].to_string();
    }
    value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_block_and_inline_lists() {
        let document = "kubeconfigSources:\n  - /home/a/config\n  - \"/path with spaces/config\"\n";
        assert_eq!(
            parse_settings(document).kubeconfig_sources,
            vec!["/home/a/config", "/path with spaces/config"]
        );
        assert_eq!(
            parse_settings("kubeconfigSources: [/a, '/b']").kubeconfig_sources,
            vec!["/a", "/b"]
        );
        assert!(parse_settings("kubeconfigSources: []").kubeconfig_sources.is_empty());
    }

    #[test]
    fn drops_unknown_keys_and_dedupes() {
        let document = "other: value\nkubeconfigSources:\n  - /a\n  - /a\n";
        assert_eq!(parse_settings(document).kubeconfig_sources, vec!["/a"]);
    }

    #[test]
    fn serialize_round_trips_through_parse() {
        let settings = AsterSettings {
            kubeconfig_sources: vec!["/a".into(), "/b c".into()],
            include_standard_chain: true,
            welcomed_at: None,
            ..AsterSettings::default()
        };
        assert_eq!(parse_settings(&serialize_settings(&settings)).kubeconfig_sources, settings.kubeconfig_sources);
        assert_eq!(serialize_settings(&AsterSettings::default()), "kubeconfigSources: []\n");
    }

    #[test]
    fn normalize_trims_dedupes_and_caps() {
        let long = "x".repeat(MAX_PATH_LENGTH + 1);
        let result = normalize_sources(vec![" /a ".into(), "/a".into(), long, "/b".into()]);
        assert_eq!(result, vec!["/a", "/b"]);
    }

    #[test]
    fn chain_flag_defaults_on_and_round_trips() {
        // Older files never mention the key and must keep the chain.
        assert!(parse_settings("kubeconfigSources: []").include_standard_chain);
        assert!(!parse_settings("includeStandardChain: false\nkubeconfigSources: []").include_standard_chain);
        assert!(parse_settings("includeStandardChain: true\n").include_standard_chain);

        let off = AsterSettings { kubeconfig_sources: vec![], include_standard_chain: false, welcomed_at: None, ..AsterSettings::default() };
        let parsed = parse_settings(&serialize_settings(&off));
        assert!(!parsed.include_standard_chain);
        assert_eq!(serialize_settings(&AsterSettings::default()), "kubeconfigSources: []\n");
    }

    #[test]
    fn welcomed_stamp_defaults_absent_and_round_trips() {
        // Files written before the welcome card must parse as never welcomed.
        assert_eq!(parse_settings("kubeconfigSources: []").welcomed_at, None);
        assert_eq!(parse_settings("welcomedAt:\n").welcomed_at, None);

        let document = "welcomedAt: \"2026-09-02T04:00:00Z\"\nkubeconfigSources: []\n";
        assert_eq!(
            parse_settings(document).welcomed_at.as_deref(),
            Some("2026-09-02T04:00:00Z")
        );

        let welcomed = AsterSettings {
            kubeconfig_sources: vec![],
            include_standard_chain: true,
            welcomed_at: Some("2026-09-02T04:00:00Z".into()),
            ..AsterSettings::default()
        };
        let serialized = serialize_settings(&welcomed);
        assert_eq!(parse_settings(&serialized).welcomed_at, welcomed.welcomed_at);
        // The stamp never lands in a default (never-welcomed) document.
        assert!(!serialize_settings(&AsterSettings::default()).contains("welcomedAt"));
    }

    #[test]
    fn mark_welcomed_stamps_once_and_survives_source_rewrites() {
        let directory = std::env::temp_dir().join(format!("aster-settings-test-{}", std::process::id()));
        let file = SettingsFile::new(directory.join("config.yaml"));
        // A pre-existing file from an older version: no stamp, chain on.
        file.write(&AsterSettings { kubeconfig_sources: vec!["/a".into()], include_standard_chain: true, welcomed_at: None, ..AsterSettings::default() });

        let stamped = file.mark_welcomed_with("2026-09-02T04:00:00Z");
        assert_eq!(stamped.welcomed_at.as_deref(), Some("2026-09-02T04:00:00Z"));
        // Idempotent: a second dismiss keeps the original stamp.
        assert_eq!(
            file.mark_welcomed_with("2027-01-01T00:00:00Z").welcomed_at.as_deref(),
            Some("2026-09-02T04:00:00Z")
        );
        // Rewriting kubeconfig sources (the command's own shape) preserves it.
        file.write(&AsterSettings {
            kubeconfig_sources: vec!["/b".into()],
            include_standard_chain: false,
            welcomed_at: file.read().welcomed_at,
            ..file.read()
        });
        assert_eq!(file.read().welcomed_at.as_deref(), Some("2026-09-02T04:00:00Z"));
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn context_aliases_default_absent_and_round_trip() {
        // Files written before aliases exist must parse with none.
        assert!(parse_settings("kubeconfigSources: []").context_aliases.is_empty());
        assert!(!serialize_settings(&AsterSettings::default()).contains("contextAliases"));

        // Quoted keys carry colons (EKS ARN-style context ids); values hold
        // spaces; the section ends at the next known key.
        let document = concat!(
            "contextAliases:\n",
            "  \"arn:aws:eks:us-east-1:123456789012:cluster/prod\": \"Prod EU\"\n",
            "  \"dev\": dev-local\n",
            "kubeconfigSources: []\n",
        );
        let parsed = parse_settings(document);
        assert_eq!(
            parsed.context_aliases.get("arn:aws:eks:us-east-1:123456789012:cluster/prod").map(String::as_str),
            Some("Prod EU")
        );
        assert_eq!(parsed.context_aliases.get("dev").map(String::as_str), Some("dev-local"));

        let settings = AsterSettings {
            context_aliases: parsed.context_aliases.clone(),
            ..AsterSettings::default()
        };
        assert_eq!(parse_settings(&serialize_settings(&settings)).context_aliases, parsed.context_aliases);
    }

    #[test]
    fn alias_parsing_drops_junk_entries() {
        let document = format!(
            concat!(
                "contextAliases:\n",
                "  \"\": no-key\n",
                "  \"a\": \"\"\n",
                "  \"b\": \"{}\"\n",
                "  not-an-entry\n",
            ),
            "x".repeat(MAX_ALIAS_LENGTH + 1)
        );
        let parsed = parse_settings(&document);
        assert!(parsed.context_aliases.is_empty());
        // Escaped quotes inside keys stay intact through a round trip.
        let document = "contextAliases:\n  \"we \\\"ird\\\" name\": \"Alias\"\n";
        let parsed = parse_settings(document);
        assert_eq!(parsed.context_aliases.get("we \"ird\" name").map(String::as_str), Some("Alias"));
    }

    #[test]
    fn set_context_alias_writes_and_removes() {
        let directory = std::env::temp_dir().join(format!("aster-alias-test-{}", std::process::id()));
        let file = SettingsFile::new(directory.join("config.yaml"));
        file.write(&AsterSettings::default());

        let set = file.set_context_alias("dev", Some("  Dev local  "));
        assert_eq!(set.context_aliases.get("dev").map(String::as_str), Some("Dev local"));
        assert_eq!(file.read().context_aliases.get("dev").map(String::as_str), Some("Dev local"));

        // Blank and overlong aliases both mean removal; unrelated keys stay.
        let cleared = file.set_context_alias("dev", Some("   "));
        assert!(!cleared.context_aliases.contains_key("dev"));
        let too_long = file.set_context_alias("dev", Some(&"x".repeat(MAX_ALIAS_LENGTH + 1)));
        assert!(!too_long.context_aliases.contains_key("dev"));
        // A blank context id never writes an entry under the empty key.
        let empty_id = file.set_context_alias("   ", Some("Alias"));
        assert!(empty_id.context_aliases.is_empty());
        let _ = fs::remove_dir_all(&directory);
    }
}
