use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Port of AppUpdater (src/main/updater.ts) over tauri-plugin-updater: the
/// renderer only ever sees UpdaterSnapshot values, download waits for an
/// explicit user action, and install is a restart into the downloaded bundle.
const POLL_INTERVAL: Duration = Duration::from_secs(4 * 60 * 60);
const RELEASE_TAG_URL: &str = "https://github.com/zjy365/aster/releases/tag";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdaterState {
    Disabled,
    Idle,
    Checking,
    Available,
    NotAvailable,
    Downloading,
    Downloaded,
    Error,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterSnapshot {
    pub state: UpdaterState,
    pub current_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress_percent: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl UpdaterSnapshot {
    fn bare(state: UpdaterState, current_version: String) -> Self {
        Self {
            state,
            current_version,
            version: None,
            release_notes: None,
            release_url: None,
            progress_percent: None,
            message: None,
        }
    }
}

pub struct Updater {
    app: AppHandle,
    snapshot: RwLock<UpdaterSnapshot>,
    pending: Mutex<Option<Update>>,
    downloaded: Mutex<Option<Vec<u8>>>,
}

impl Updater {
    pub fn new(app: AppHandle) -> Arc<Self> {
        let state = if tauri::is_dev() { UpdaterState::Disabled } else { UpdaterState::Idle };
        Arc::new(Self {
            snapshot: RwLock::new(UpdaterSnapshot::bare(state, app.package_info().version.to_string())),
            app,
            pending: Mutex::new(None),
            downloaded: Mutex::new(None),
        })
    }

    pub fn current_state(&self) -> UpdaterSnapshot {
        self.snapshot.read().unwrap().clone()
    }

    pub fn start(self: &Arc<Self>) {
        if self.current_state().state == UpdaterState::Disabled {
            return;
        }
        let this = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            this.check().await;
            let mut interval = tokio::time::interval(POLL_INTERVAL);
            interval.tick().await; // the first tick fires immediately; skip it
            loop {
                interval.tick().await;
                let state = this.current_state().state;
                if state != UpdaterState::Downloading && state != UpdaterState::Downloaded {
                    this.check().await;
                }
            }
        });
    }

    pub async fn check(&self) {
        // A check while an update is downloading or downloaded would clobber
        // the progress state; the renderer can retry after install or dismiss.
        match self.current_state().state {
            UpdaterState::Disabled | UpdaterState::Downloading | UpdaterState::Downloaded => return,
            _ => {}
        }
        self.transition(UpdaterState::Checking);
        let updater = match self.app.updater() {
            Ok(updater) => updater,
            Err(error) => {
                self.transition_patch(UpdaterState::Error, |snapshot: &mut UpdaterSnapshot| snapshot.message = Some(error.to_string()));
                return;
            }
        };
        match updater.check().await {
            Ok(Some(update)) => {
                let version = update.version.clone();
                let notes = update.body.as_deref().and_then(release_notes_text);
                *self.pending.lock().unwrap() = Some(update);
                self.transition_patch(UpdaterState::Available, |snapshot: &mut UpdaterSnapshot| {
                    snapshot.version = Some(version.clone());
                    snapshot.release_notes = notes;
                    snapshot.release_url = Some(format!("{RELEASE_TAG_URL}/v{version}"));
                });
            }
            Ok(None) => self.transition(UpdaterState::NotAvailable),
            Err(error) => {
                self.transition_patch(UpdaterState::Error, |snapshot: &mut UpdaterSnapshot| snapshot.message = Some(error.to_string()));
            }
        }
    }

    pub async fn download(self: &Arc<Self>) {
        if self.current_state().state != UpdaterState::Available {
            return;
        }
        let update = self.pending.lock().unwrap().take();
        let Some(update) = update else { return };
        self.transition_patch(UpdaterState::Downloading, |snapshot: &mut UpdaterSnapshot| snapshot.progress_percent = Some(0));
        let received = AtomicU64::new(0);
        let this = Arc::clone(self);
        let result = update
            .download(
                |chunk_length, content_length| {
                    let total = received.fetch_add(chunk_length as u64, Ordering::Relaxed) + chunk_length as u64;
                    if let Some(content_length) = content_length {
                        if content_length > 0 {
                            let percent = (total.saturating_mul(100) / content_length) as u32;
                            this.transition_patch(UpdaterState::Downloading, |snapshot: &mut UpdaterSnapshot| {
                                snapshot.progress_percent = Some(percent);
                            });
                        }
                    }
                },
                || {},
            )
            .await;
        match result {
            Ok(bytes) => {
                *self.pending.lock().unwrap() = Some(update);
                *self.downloaded.lock().unwrap() = Some(bytes);
                self.transition(UpdaterState::Downloaded);
            }
            Err(error) => {
                self.transition_patch(UpdaterState::Error, |snapshot: &mut UpdaterSnapshot| snapshot.message = Some(error.to_string()));
            }
        }
    }

    pub fn install(&self) {
        if self.current_state().state != UpdaterState::Downloaded {
            return;
        }
        let update = self.pending.lock().unwrap().take();
        let bytes = self.downloaded.lock().unwrap().take();
        let (Some(update), Some(bytes)) = (update, bytes) else { return };
        match update.install(&bytes) {
            Ok(()) => self.app.restart(),
            Err(error) => {
                self.transition_patch(UpdaterState::Error, |snapshot: &mut UpdaterSnapshot| snapshot.message = Some(error.to_string()));
            }
        }
    }

    /// Mirrors the Electron snapshot semantics: a transition without a patch
    /// clears the detail fields; a patch merges into them.
    fn transition(&self, state: UpdaterState) {
        self.apply(state, None::<fn(&mut UpdaterSnapshot)>);
    }

    fn transition_patch(&self, state: UpdaterState, patch: impl FnOnce(&mut UpdaterSnapshot)) {
        self.apply(state, Some(patch));
    }

    fn apply(&self, state: UpdaterState, patch: Option<impl FnOnce(&mut UpdaterSnapshot)>) {
        let value = {
            let mut snapshot = self.snapshot.write().unwrap();
            snapshot.state = state;
            match patch {
                Some(apply) => apply(&mut snapshot),
                None => {
                    snapshot.version = None;
                    snapshot.release_notes = None;
                    snapshot.release_url = None;
                    snapshot.progress_percent = None;
                    snapshot.message = None;
                }
            }
            snapshot.clone()
        };
        let _ = self.app.emit("updater:state-changed", value);
    }
}

/// Turns a GitHub release body into safe plain text; the renderer never
/// renders update notes as HTML. Port of releaseNotesText in
/// src/shared/normalize.ts — keep the two in sync.
pub fn release_notes_text(value: &str) -> Option<String> {
    use regex::Regex;

    let comments = Regex::new(r"(?s)<!--.*?-->").unwrap();
    let tags = Regex::new(r"<[^>]+>").unwrap();
    let entities = Regex::new(r"&(amp|lt|gt|quot|apos|#39|nbsp);").unwrap();
    let links = Regex::new(r"\[([^\]]+)\]\([^)]*\)").unwrap();
    let markers = Regex::new(r"[*_`#>]+").unwrap();
    let spaces = Regex::new(r"[ \t]+").unwrap();
    let newlines = Regex::new(r"\n{3,}").unwrap();

    let without_comments = comments.replace_all(value, "");
    let without_markup = tags.replace_all(&without_comments, " ");
    let text = entities.replace_all(&without_markup, |captures: &regex::Captures| {
        match &captures[1] {
            "amp" => "&",
            "lt" => "<",
            "gt" => ">",
            "quot" => "\"",
            "apos" | "#39" => "'",
            _ => " ",
        }
    });
    let text = links.replace_all(&text, "$1");
    let text = markers.replace_all(&text, " ");
    let text = spaces.replace_all(&text, " ");
    let text = newlines.replace_all(&text, "\n\n");
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    Some(text.chars().take(4_000).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_notes_are_stripped_to_plain_text() {
        assert_eq!(
            release_notes_text("## Fixed\n- <b>Crash</b> on start &amp; connect"),
            Some("Fixed\n- Crash on start & connect".to_string())
        );
        assert_eq!(
            release_notes_text("See [the changelog](https://example.com) for details."),
            Some("See the changelog for details.".to_string())
        );
        assert_eq!(
            release_notes_text("<!-- hidden comment --><script>alert(1)</script>ok"),
            Some("alert(1) ok".to_string())
        );
        assert_eq!(release_notes_text("   "), None);
        assert_eq!(release_notes_text(&"x".repeat(5_000)).map(|text| text.chars().count()), Some(4_000));
    }
}
