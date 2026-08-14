import { useEffect, useState } from "react";
import type { ContextInfo, NamespaceInfo } from "../../shared/types";
import { messageOf } from "../lib/format";

export interface NamespacesState {
  namespaces: NamespaceInfo[];
  namespace: string;
  setNamespace(namespace: string): void;
}

/**
 * Loads namespaces for the connected context and applies the context's
 * default namespace. Empties out when no context is connected.
 */
export function useNamespaces(
  contextId: string,
  contexts: ContextInfo[],
  onError: (message: string) => void,
): NamespacesState {
  const [namespaces, setNamespaces] = useState<NamespaceInfo[]>([]);
  const [namespace, setNamespace] = useState("");

  useEffect(() => {
    if (!contextId) {
      setNamespaces([]);
      setNamespace("");
      return;
    }
    let active = true;
    void window.aster.namespaces.list(contextId).then((items) => {
      if (!active) return;
      setNamespaces(items);
      const context = contexts.find((item) => item.id === contextId);
      setNamespace(context?.namespace || "");
    }).catch((cause) => {
      if (active) onError(messageOf(cause));
    });
    return () => { active = false; };
  }, [contextId, contexts, onError]);

  return { namespaces, namespace, setNamespace };
}
