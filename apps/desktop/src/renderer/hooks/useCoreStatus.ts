import { useEffect, useState } from "react";
import type { CoreStatus } from "../../shared/types";
import { desktop } from "../lib/desktop";

/** Mirrors the sidecar status pushed by the Electron main process. */
export function useCoreStatus(): CoreStatus {
  const [core, setCore] = useState<CoreStatus>({ state: "starting" });

  useEffect(() => {
    desktop.core.status().then(setCore).catch(() => undefined);
    return desktop.core.onStatus(setCore);
  }, []);

  return core;
}
