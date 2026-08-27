import { useCallback, useEffect, useRef, useState } from "react";
import type { ContextInfo, NamespaceInfo } from "../../shared/types";
import { messageOf } from "../lib/format";
import { desktop } from "../lib/desktop";

export interface NamespacesState {
  namespaces: NamespaceInfo[];
  /** True when the core capped the namespace list; pickers should say so. */
  truncated: boolean;
  /** True while the lazy first fetch is in flight; pickers show a loading row. */
  loading: boolean;
  namespace: string;
  setNamespace(namespace: string): void;
  /** Lazily fetches the namespace list on first use (pickers, ⌘K). */
  load(): void;
}

/**
 * Applies the context's default namespace on connect and lazily loads the
 * namespace list. In a 100k+ namespace cluster the list can take seconds and
 * tens of pages to fetch, so it is never loaded eagerly at connect time —
 * only when the top picker or the command palette first needs it, once.
 * Failures surface through onError and allow a retry on the next open.
 */
export function useNamespaces(
  contextId: string,
  contexts: ContextInfo[],
  onError: (message: string) => void,
): NamespacesState {
  const [namespaces, setNamespaces] = useState<NamespaceInfo[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [namespace, setNamespace] = useState("");
  const [loaded, setLoaded] = useState(false);
  const loadingRef = useRef(false);
  // Bumped on every context change so a slow fetch started under the previous
  // context is discarded when it resolves late.
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    loadingRef.current = false;
    setNamespaces([]);
    setTruncated(false);
    setLoading(false);
    setLoaded(false);
    if (!contextId) {
      setNamespace("");
      return;
    }
    // The context's default namespace is known without the list.
    const context = contexts.find((item) => item.id === contextId);
    setNamespace(context?.namespace || "");
    // Only a context switch resets the list; contexts identity churn must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextId]);

  const load = useCallback(() => {
    if (!contextId || loaded || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    const generation = generationRef.current;
    desktop.namespaces.list(contextId)
      .then((result) => {
        if (generation !== generationRef.current) return;
        loadingRef.current = false;
        setLoading(false);
        setNamespaces(result.namespaces);
        setTruncated(result.truncated);
        setLoaded(true);
      })
      .catch((cause) => {
        // Keep loadingRef false so the next open retries; the picker stays on
        // "All namespaces" rather than showing a broken partial list.
        if (generation !== generationRef.current) return;
        loadingRef.current = false;
        setLoading(false);
        onError(messageOf(cause));
      });
  }, [contextId, loaded, onError]);

  return { namespaces, truncated, loading, namespace, setNamespace, load };
}
