// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { mostUsedKindIds, recordKindUsage, toggleFavoriteKind } from "./resource-favorites";

describe("toggleFavoriteKind", () => {
  it("appends in starring order and removes without reordering the rest", () => {
    let favorites = toggleFavoriteKind([], "pods");
    favorites = toggleFavoriteKind(favorites, "deployments");
    favorites = toggleFavoriteKind(favorites, "services");
    expect(favorites).toEqual(["pods", "deployments", "services"]);
    expect(toggleFavoriteKind(favorites, "deployments")).toEqual(["pods", "services"]);
  });

  it("toggling twice returns to the original list", () => {
    expect(toggleFavoriteKind(toggleFavoriteKind(["pods"], "jobs"), "jobs")).toEqual(["pods"]);
  });
});

describe("recordKindUsage", () => {
  it("bumps the counter without mutating the input", () => {
    const usage = { pods: 2 };
    expect(recordKindUsage(usage, "pods")).toEqual({ pods: 3 });
    expect(recordKindUsage(usage, "jobs")).toEqual({ pods: 2, jobs: 1 });
    expect(usage).toEqual({ pods: 2 });
  });
});

describe("mostUsedKindIds", () => {
  it("ranks by open count, best first, capped at the limit", () => {
    const usage = { pods: 9, deployments: 5, services: 2, jobs: 1 };
    expect(mostUsedKindIds(usage, new Set(), 3)).toEqual(["pods", "deployments", "services"]);
  });

  it("skips starred kinds and zero counts", () => {
    const usage = { pods: 9, deployments: 5, services: 0 };
    expect(mostUsedKindIds(usage, new Set(["pods"]), 3)).toEqual(["deployments"]);
  });

  it("breaks ties deterministically so restarts keep the order", () => {
    const usage = { services: 2, jobs: 2 };
    expect(mostUsedKindIds(usage, new Set(), 3)).toEqual(["jobs", "services"]);
  });
});
