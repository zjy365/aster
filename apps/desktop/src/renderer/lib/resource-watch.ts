import type { ResourceListResponse, ResourceRow, ResourceWatchBatch } from "../../shared/types";

export function resourceKey(row: Pick<ResourceRow, "uid" | "namespace" | "name" | "kind">): string {
  return row.uid || `${row.kind}:${row.namespace}/${row.name}`;
}

export function applyResourceWatchBatches(
  current: ResourceListResponse,
  batches: ResourceWatchBatch[],
): ResourceListResponse {
  let items = current.items;
  let resourceVersion = current.resourceVersion;
  let continueToken = current.continueToken;

  for (const batch of batches) {
    if (batch.kind === "error") continue;
    resourceVersion = batch.resourceVersion || resourceVersion;
    // Delta watch events do not carry pagination state. Preserve the token
    // from the scoped list until a snapshot explicitly replaces it.
    if ("continueToken" in batch) {
      continueToken = batch.continueToken;
    }
    if (batch.kind === "snapshot") {
      items = batch.items;
      continue;
    }
    const byKey = new Map(items.map((row) => [resourceKey(row), row]));
    for (const event of batch.events) {
      if (event.type === "deleted") byKey.delete(event.key);
      else byKey.set(resourceKey(event.row), event.row);
    }
    items = [...byKey.values()];
  }

  const response: ResourceListResponse = {
    ...current,
    items,
    ...(resourceVersion ? { resourceVersion } : {}),
  };
  if (continueToken) response.continueToken = continueToken;
  else delete response.continueToken;
  return response;
}
