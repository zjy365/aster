import { useEffect, useState } from "react";
import type { CoreStatus } from "../../shared/types";

/** Mirrors the sidecar status pushed by the Electron main process. */
export function useCoreStatus(): CoreStatus {
  const [core, setCore] = useState<CoreStatus>({ state: "starting" });

  useEffect(() => {
    setCore(window.aster.core.status());
    return window.aster.core.onStatus(setCore);
  }, []);

  return core;
}
