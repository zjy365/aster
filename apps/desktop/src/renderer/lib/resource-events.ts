// SPDX-License-Identifier: Apache-2.0

import type { ResourceEvent } from "../../shared/types";

/**
 * The shared tail of every event timeline in the app: sort newest-first by
 * lastTimestamp, cap the timeline, and return plain rows. Both halves of the
 * Events tab (the object's one-shot fetch and the pod-events poll) shape
 * their output through this.
 */
export function newestEventsFirst(events: ResourceEvent[], limit: number): ResourceEvent[] {
  const withKeys = events.map((event) => ({ ...event, sortKey: event.lastTimestamp || "" }));
  withKeys.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
  return withKeys.slice(0, limit).map(({ sortKey: _sortKey, ...event }) => event);
}
