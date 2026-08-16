import { useCallback, useEffect, useRef, useState } from "react";
import type { UpdaterSnapshot } from "../../shared/types";
import { desktop } from "../lib/desktop";

const IDLE_SNAPSHOT: UpdaterSnapshot = { state: "idle", currentVersion: "" };
const CARD_STATES: UpdaterSnapshot["state"][] = ["available", "downloading", "downloaded"];

export interface UpdateCard {
  state: UpdaterSnapshot["state"];
  currentVersion: string;
  version?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  progressPercent?: number;
  message?: string;
  download: () => void;
  install: () => void;
  dismiss: () => void;
}

/**
 * Mirrors the updater state machine owned by the Electron main process. The
 * card stays hidden until a new version is announced; errors only surface
 * after an update was seen, and a dismissed version never comes back.
 */
export function useUpdater(): UpdateCard | undefined {
  const [snapshot, setSnapshot] = useState<UpdaterSnapshot>(IDLE_SNAPSHOT);
  const dismissedVersion = useRef<string | undefined>(undefined);
  const hadUpdate = useRef(false);

  useEffect(() => {
    let alive = true;
    void desktop.updater.state().then((current) => {
      if (alive) setSnapshot(current);
    }).catch(() => undefined);
    const stop = desktop.updater.onState((next) => {
      if (alive) setSnapshot(next);
    });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  const download = useCallback(() => void desktop.updater.download().catch(() => undefined), []);
  const install = useCallback(() => void desktop.updater.install().catch(() => undefined), []);

  if (CARD_STATES.includes(snapshot.state)) hadUpdate.current = true;
  const dismissed = snapshot.version !== undefined && dismissedVersion.current === snapshot.version;
  const showError = snapshot.state === "error" && hadUpdate.current && !dismissed;
  const visible = (!dismissed && CARD_STATES.includes(snapshot.state)) || showError;
  if (!visible) return undefined;

  return {
    state: snapshot.state,
    currentVersion: snapshot.currentVersion,
    version: snapshot.version,
    releaseNotes: snapshot.releaseNotes,
    releaseUrl: snapshot.releaseUrl,
    progressPercent: snapshot.progressPercent,
    message: snapshot.message,
    download,
    install,
    dismiss: () => {
      dismissedVersion.current = snapshot.version;
      setSnapshot((current) => ({ ...current }));
    },
  };
}
