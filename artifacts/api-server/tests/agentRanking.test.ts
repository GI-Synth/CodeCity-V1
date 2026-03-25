import { describe, expect, it } from "vitest";
import { computeRank } from "../src/lib/agentRanking";

describe("computeRank", () => {
  it("returns principal at principal thresholds", () => {
    expect(computeRank(100, 0.9, 10)).toBe("principal");
  });

  it("returns senior when principal requirements are not met", () => {
    expect(computeRank(80, 0.85, 5)).toBe("senior");
  });

  it("returns mid for mid-level thresholds", () => {
    expect(computeRank(25, 0.65, 0)).toBe("mid");
  });

  it("returns junior below mid thresholds", () => {
    expect(computeRank(19, 0.95, 30)).toBe("junior");
    expect(computeRank(40, 0.59, 30)).toBe("junior");
  });
});
