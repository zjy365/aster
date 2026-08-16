import { useCallback, useEffect, useState } from "react";
import type { ResourceKind, ResourceMutationRequest, ResourceRow } from "../../shared/types";
import { messageOf } from "../lib/format";
import { desktop } from "../lib/desktop";

export type MutationDraft = Omit<ResourceMutationRequest, "contextId" | "resourceKind" | "namespace" | "name">;

/** Secrets stay read-only: their data never leaves the core, so editing cannot round-trip. */
function writable(kind: ResourceKind): boolean {
  return kind.resource !== "secrets";
}

export interface MutationOptions {
  contextId: string;
  kind: ResourceKind;
  namespace: string;
  selected?: ResourceRow;
  readOnly: boolean;
  writePolicySynced: boolean;
}

export interface MutationState {
  canMutate: boolean;
  canCreate: boolean;
  mutationBusy: boolean;
  mutationMessage: string;
  mutationPreview: string;
  pendingMutation?: ResourceMutationRequest;
  journal: string[];
  /** Runs the dry-run and stages the pending mutation for review. */
  mutate(request: MutationDraft): Promise<void>;
  applyPendingMutation(): Promise<void>;
  cancelMutation(): void;
}

/**
 * Owns the dry-run → review → apply mutation flow plus the per-context
 * operation journal. Every write — scale, image, restart, full YAML,
 * create, delete — passes this gate, and the main process re-checks the
 * read-only policy at the IPC boundary.
 */
export function useMutation({ contextId, kind, namespace, selected, readOnly, writePolicySynced }: MutationOptions): MutationState {
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationMessage, setMutationMessage] = useState("");
  const [mutationPreview, setMutationPreview] = useState("");
  const [pendingMutation, setPendingMutation] = useState<ResourceMutationRequest>();
  const [journalByContext, setJournalByContext] = useState<Record<string, string[]>>(() => {
    try {
      return JSON.parse(localStorage.getItem("aster.operationJournal") || "{}") as Record<string, string[]>;
    } catch {
      return {};
    }
  });

  const journal = journalByContext[contextId] || [];
  const canMutate = !readOnly && writePolicySynced && Boolean(selected) && writable(kind);
  const canCreate = !readOnly && writePolicySynced && writable(kind);

  useEffect(() => {
    localStorage.setItem("aster.operationJournal", JSON.stringify(journalByContext));
  }, [journalByContext]);

  useEffect(() => {
    setMutationMessage("");
    setMutationPreview("");
    setPendingMutation(undefined);
  }, [contextId, kind.id, selected?.uid]);

  const mutate = useCallback(async (request: MutationDraft) => {
    if (!contextId || readOnly) return;
    const isCreate = request.operation === "create";
    if (!isCreate && !selected) return;
    setMutationBusy(true);
    setMutationMessage("Preparing dry-run…");
    try {
      const base: ResourceMutationRequest = isCreate
        ? { contextId, resourceKind: kind, namespace: namespace || undefined, name: "", ...request }
        : { contextId, resourceKind: kind, namespace: selected?.namespace || undefined, name: selected?.name || "", resourceVersion: selected?.resourceVersion, ...request };
      const preview = await desktop.resources.mutate({ ...base, dryRun: true });
      setMutationPreview(preview.yaml || "");
      setPendingMutation(base);
      setMutationMessage(preview.changed ? "Dry-run ready — review the Diff" : "Dry-run found no changes");
    } catch (cause) {
      setMutationMessage(messageOf(cause));
    } finally {
      setMutationBusy(false);
    }
  }, [contextId, kind, namespace, readOnly, selected]);

  const applyPendingMutation = useCallback(async () => {
    if (!pendingMutation || readOnly || !writePolicySynced) return;
    setMutationBusy(true);
    setMutationMessage("Applying…");
    try {
      const applied = await desktop.resources.mutate({ ...pendingMutation, dryRun: false });
      const targetName = applied.name || pendingMutation.name;
      setJournalByContext((all) => ({ ...all, [pendingMutation.contextId]: [`${new Date().toLocaleTimeString()} ${pendingMutation.operation} ${targetName}`.trim(), ...(all[pendingMutation.contextId] || [])].slice(0, 20) }));
      setMutationMessage(applied.changed ? "Applied" : "No change needed");
      setPendingMutation(undefined);
      setMutationPreview("");
    } catch (cause) {
      setMutationMessage(messageOf(cause));
    } finally {
      setMutationBusy(false);
    }
  }, [pendingMutation, readOnly, writePolicySynced]);

  const cancelMutation = useCallback(() => {
    setPendingMutation(undefined);
    setMutationPreview("");
    setMutationMessage("Dry-run discarded");
  }, []);

  return {
    canMutate,
    canCreate,
    mutationBusy,
    mutationMessage,
    mutationPreview,
    pendingMutation,
    journal,
    mutate,
    applyPendingMutation,
    cancelMutation,
  };
}
