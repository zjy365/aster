import { ArrowDownToLine, RotateCw, TriangleAlert, X } from "lucide-react";
import type { UpdateCard } from "../hooks/useUpdater";

/**
 * Bottom-right update card: new-version announcement with release notes, a
 * changelog link, and the update lifecycle (download → restart).
 */
export function UpdateNotice({ card }: { card: UpdateCard }) {
  if (card.state === "error") {
    return (
      <aside className="update-notice" data-testid="update-notice" data-state="error" role="alert">
        <div className="update-notice-body">
          <p className="update-notice-title">
            <TriangleAlert size={15} aria-hidden />
            Update check failed
          </p>
          <p className="update-notice-notes">{card.message || "The update could not be downloaded. Try again later."}</p>
        </div>
        <button className="update-notice-close" data-testid="update-dismiss" aria-label="Dismiss update message" onClick={card.dismiss}>
          <X size={14} aria-hidden />
        </button>
      </aside>
    );
  }

  const downloading = card.state === "downloading";
  const downloaded = card.state === "downloaded";

  return (
    <aside className="update-notice" data-testid="update-notice" data-state={card.state} role="status">
      <button className="update-notice-close" data-testid="update-dismiss" aria-label="Dismiss update message" onClick={card.dismiss}>
        <X size={14} aria-hidden />
      </button>
      <div className="update-notice-body">
        <p className="update-notice-title">
          {downloaded ? "Update ready to install" : `Version ${card.version || "update"} available`}
        </p>
        {card.releaseNotes && <p className="update-notice-notes">{card.releaseNotes}</p>}
        {downloading && (
          <div
            className="update-notice-progress"
            data-testid="update-progress"
            data-percent={card.progressPercent ?? 0}
            aria-label={card.progressPercent === undefined ? "Downloading update" : `Downloading update ${card.progressPercent}%`}
          >
            <div className="update-notice-progress-track">
              <div
                className="update-notice-progress-fill"
                style={{ transform: `scaleX(${Math.min(100, Math.max(0, card.progressPercent ?? 0)) / 100})` }}
              />
            </div>
            <span>{card.progressPercent === undefined ? "Downloading…" : `${card.progressPercent}%`}</span>
          </div>
        )}
        <div className="update-notice-actions">
          {card.releaseUrl && card.state !== "downloaded" && (
            <a className="update-notice-link" data-testid="update-link" href={card.releaseUrl} target="_blank" rel="noreferrer">
              What&apos;s changed
            </a>
          )}
          {downloaded ? (
            <button className="update-notice-primary" data-testid="update-install" onClick={card.install}>
              <RotateCw size={13} aria-hidden />
              Restart to update
            </button>
          ) : downloading ? (
            <span className="update-notice-hint">You can keep working while it downloads.</span>
          ) : (
            <button className="update-notice-primary" data-testid="update-download" onClick={card.download}>
              <ArrowDownToLine size={13} aria-hidden />
              Update
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
