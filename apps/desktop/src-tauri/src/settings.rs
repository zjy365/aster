use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;

/// Application settings on disk (~/.config/aster/config.yaml, honoring
/// XDG_CONFIG_HOME). Port of src/main/settings.ts: the schema is a strict
/// whitelist and kubeconfig sources are path references — file contents
/// never enter the renderer and are never copied.
const MAX_SOURCES: usize = 64;
const MAX_PATH_LENGTH: usize = 2048;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AsterSettings {
    pub kubeconfig_sources: Vec<String>,
    /// The standard chain ($KUBECONFIG + ~/.kube/config) participates unless
    /// the user turns it off. It is a default, not a privilege: with it off
    /// and no configured sources the app simply has no clusters.
    pub include_standard_chain: bool,
}

impl Default for AsterSettings {
    fn default() -> Self {
        Self { kubeconfig_sources: Vec::new(), include_standard_chain: true }
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
        let base = std::env::var("XDG_CONFIG_HOME")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".config"));
        Self::new(base.join("aster").join("config.yaml"))
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
}

/// Parses the settings document; unknown keys are dropped, not merged.
pub fn parse_settings(document: &str) -> AsterSettings {
    let mut sources: Vec<String> = Vec::new();
    // Absent means true, so settings files written by older versions keep
    // the chain.
    let mut include_standard_chain = true;
    let mut in_list = false;
    for line in document.split('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("includeStandardChain:") {
            include_standard_chain = rest.trim() != "false";
            in_list = false;
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
                continue;
            }
            in_list = rest.is_empty();
            continue;
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
    AsterSettings { kubeconfig_sources: sources, include_standard_chain }
}

pub fn serialize_settings(settings: &AsterSettings) -> String {
    // The chain flag is only written when off; its absence parses as on.
    let mut output = String::new();
    if !settings.include_standard_chain {
        output.push_str("includeStandardChain: false\n");
    }
    if settings.kubeconfig_sources.is_empty() {
        output.push_str("kubeconfigSources: []\n");
        return output;
    }
    output.push_str("kubeconfigSources:\n");
    for source in &settings.kubeconfig_sources {
        let quoted = serde_json::to_string(source).unwrap_or_else(|_| format!("\"{source}\""));
        output.push_str(&format!("  - {quoted}\n"));
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
        let settings = AsterSettings { kubeconfig_sources: vec!["/a".into(), "/b c".into()], include_standard_chain: true };
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

        let off = AsterSettings { kubeconfig_sources: vec![], include_standard_chain: false };
        let parsed = parse_settings(&serialize_settings(&off));
        assert!(!parsed.include_standard_chain);
        assert_eq!(serialize_settings(&AsterSettings::default()), "kubeconfigSources: []\n");
    }
}
