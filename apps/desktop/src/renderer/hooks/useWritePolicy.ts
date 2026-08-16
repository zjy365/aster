import { useEffect, useState } from "react";
import { messageOf } from "../lib/format";
import { desktop } from "../lib/desktop";

export interface WritePolicyState {
  /** Defaults to true for every context until the user explicitly enables writes. */
  readOnly: boolean;
  /** True once the main process acknowledged the current policy. */
  writePolicySynced: boolean;
  toggleReadOnly(): void;
}

/**
 * Owns the per-context read-only preference: localStorage persistence and
 * the sync into the main-process WriteSafetyPolicy that actually enforces it.
 */
export function useWritePolicy(contextId: string, onError: (message: string) => void): WritePolicyState {
  const [readOnlyByContext, setReadOnlyByContext] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("aster.readOnlyByContext") || "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const [writePolicySynced, setWritePolicySynced] = useState(false);

  const readOnly = readOnlyByContext[contextId] !== false;

  useEffect(() => {
    localStorage.setItem("aster.readOnlyByContext", JSON.stringify(readOnlyByContext));
  }, [readOnlyByContext]);

  useEffect(() => {
    setWritePolicySynced(false);
    if (!contextId) return;
    let active = true;
    void desktop.safety.setReadOnly(contextId, readOnly)
      .then(() => { if (active) setWritePolicySynced(true); })
      .catch((cause) => { if (active) onError(messageOf(cause)); });
    return () => { active = false; };
  }, [contextId, readOnly, onError]);

  const toggleReadOnly = () => {
    setReadOnlyByContext((all) => ({ ...all, [contextId]: !readOnly }));
  };

  return { readOnly, writePolicySynced, toggleReadOnly };
}
