// SPDX-License-Identifier: Apache-2.0

/**
 * Shared slow-poll cadence for best-effort surfaces (pod usage, events).
 * One named clock keeps the app's background chatter in step: surfaces that
 * fan out per namespace all fire on the same tick instead of drifting.
 */
export const SLOW_POLL_MS = 15_000;
