import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "../src/lib/vectorMath";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 8);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 8);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([2, 0], [-2, 0])).toBeCloseTo(-1, 8);
  });

  it("returns 0 for different dimensions or zero vectors", () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });
});
