// SPDX-License-Identifier: Apache-2.0
import { ExternalLink, Star, X } from "lucide-react";

import { Kbd } from "@/components/ui/kbd";
import { QUICKSTART_URL, REPO_URL, REPORT_URL } from "../lib/links";

/**
 * One-shot first-run card: appears the first time the user lands on the
 * resource list and is gone forever once closed (the shell stores the stamp;
 * the renderer decides when to show it). Teaches only the shortcuts that
 * actually exist and the two places to get help. The dismissible-notice
 * placement follows UpdateNotice; the two never stack — the update card
 * defers while this one is up.
 */
export function WelcomeCard({
  isMac,
  onDismiss,
  onOpenExternal,
}: {
  isMac: boolean;
  onDismiss(): void;
  onOpenExternal(url: string): void;
}) {
  return (
    <aside className="welcome-card" data-testid="welcome-card" role="status" aria-label="Welcome to Aster">
      <button className="welcome-card-close" data-testid="welcome-dismiss" aria-label="Dismiss welcome card" onClick={onDismiss}>
        <X size={14} aria-hidden />
      </button>
      <p className="welcome-card-title">Welcome aboard</p>
      <ul className="welcome-card-list">
        <li>
          <Kbd>{isMac ? "⌘K" : "Ctrl+K"}</Kbd>
          <span>Command palette — switch clusters, jump to any resource, search the cluster</span>
        </li>
        <li>
          <Kbd>{isMac ? "⌘F" : "Ctrl+F"}</Kbd>
          <Kbd>↑↓</Kbd>
          <Kbd>↵</Kbd>
          <Kbd>Esc</Kbd>
          <span>Filter the list, open a row, step back</span>
        </li>
        <li>
          <button
            type="button"
            className="welcome-card-link"
            data-testid="welcome-link-star"
            onClick={() => onOpenExternal(REPO_URL)}
          >
            <Star size={12} aria-hidden />
            Star on GitHub
            <ExternalLink size={11} aria-hidden />
          </button>
          <span>Free way to support the project</span>
        </li>
        <li>
          <button
            type="button"
            className="welcome-card-link"
            data-testid="welcome-link-docs"
            onClick={() => onOpenExternal(QUICKSTART_URL)}
          >
            Quickstart docs
            <ExternalLink size={11} aria-hidden />
          </button>
          <span>·</span>
          <button
            type="button"
            className="welcome-card-link"
            data-testid="welcome-link-report"
            onClick={() => onOpenExternal(REPORT_URL)}
          >
            Report an issue
            <ExternalLink size={11} aria-hidden />
          </button>
        </li>
      </ul>
    </aside>
  );
}
