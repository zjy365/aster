// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import type { DiscoveredResource } from "../../shared/types";
import { desktop } from "../lib/desktop";

/**
 * Lazily discovers custom resources (CRDs) for the connected context. Runs
 * only when the workbench is connected; discovery results are cached
 * server-side per context. Failures degrade to an empty custom section.
 */
export function useDiscovery(contextId: string, coreReady: boolean): DiscoveredResource[] {
  const [resources, setResources] = useState<DiscoveredResource[]>([]);

  useEffect(() => {
    if (!contextId || !coreReady) {
      setResources([]);
      return;
    }
    let active = true;
    desktop.discovery.list(contextId)
      .then((items) => { if (active) setResources(items); })
      .catch(() => { if (active) setResources([]); });
    return () => { active = false; };
  }, [contextId, coreReady]);

  return resources;
}
