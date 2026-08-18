import { useCallback, useEffect, useRef, useState } from "react";
import type { Overview } from "../../shared/types";
import { desktop } from "../lib/desktop";

export interface UseOverviewOptions {
  contextId: string;
  coreReady: boolean;
  /** Fetch only while the dashboard page is the active view. */
  enabled?: boolean;
}

export interface OverviewState {
  overview?: Overview;
  loading: boolean;
  error: string;
  /** Bumps on every explicit refresh so the effect re-fetches. */
  generation: number;
  refresh(): void;
}

/**
 * Fetches the cluster dashboard snapshot from the core. The overview is a
 * point-in-time aggregate (counts, capacity, recent events), so a plain
 * request per scope change is enough; manual refresh re-fetches it. The
 * dashboard is a standalone page, so fetching is gated on it being active.
 */
export function useOverview({ contextId, coreReady, enabled = true }: UseOverviewOptions): OverviewState {
  const [overview, setOverview] = useState<Overview>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    if (!contextId || !coreReady || !enabled) return;
    const current = ++request.current;
    setLoading(true);
    setError("");
    desktop.overview.get(contextId)
      .then((value) => {
        if (current !== request.current) return;
        setOverview(value);
      })
      .catch((cause) => {
        if (current !== request.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (current === request.current) setLoading(false);
      });
  }, [contextId, coreReady, enabled, generation]);

  const refresh = useCallback(() => setGeneration((value) => value + 1), []);

  return { overview, loading, error, generation, refresh };
}
