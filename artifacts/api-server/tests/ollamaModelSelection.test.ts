import { describe, expect, it } from "vitest";
import { modelMatches, pickBestModel } from "../src/lib/ollamaModelSelection";

describe("modelMatches", () => {
  it("matches exact names", () => {
    expect(modelMatches("deepseek-coder:6.7b", "deepseek-coder:6.7b")).toBe(true);
  });

  it("matches family variants", () => {
    expect(modelMatches("deepseek-coder:6.7b-q4", "deepseek-coder:6.7b")).toBe(true);
    expect(modelMatches("codellama-13b", "codellama:13b")).toBe(true);
  });

  it("does not match different families", () => {
    expect(modelMatches("tinyllama:1.1b", "codellama:13b")).toBe(false);
  });
});

describe("pickBestModel", () => {
  const priorities = ["deepseek-coder-v2:16b", "deepseek-coder:6.7b", "codellama:13b"] as const;

  it("selects highest-priority available model", () => {
    const selected = pickBestModel(["codellama:13b", "deepseek-coder:6.7b"], priorities);
    expect(selected).toBe("deepseek-coder:6.7b");
  });

  it("falls back to code-like model when no priority match exists", () => {
    const selected = pickBestModel(["qwen3-coder:free", "tinyllama:1.1b"], priorities);
    expect(selected).toBe("qwen3-coder:free");
  });

  it("falls back to first model when no match is found", () => {
    const selected = pickBestModel(["tinyllama:1.1b", "smollm2:135m"], priorities);
    expect(selected).toBe("tinyllama:1.1b");
  });
});
