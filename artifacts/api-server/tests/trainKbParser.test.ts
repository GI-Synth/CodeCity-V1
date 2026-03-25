import { describe, expect, it } from "vitest";
import { parseProviderPatterns } from "../../../scripts/train-kb";

describe("train-kb parseProviderPatterns", () => {
  it("parses strict JSON object responses", () => {
    const raw = JSON.stringify({
      patterns: [
        {
          language: "javascript",
          problemType: "Missing Try Catch",
          question: "Async call has no error boundary",
          answer: "Wrap async call in try/catch and return structured failures.",
          confidence: "high",
          domain: "general",
          patternTags: ["async", "error-handling"],
          actionItems: ["Add try/catch"],
        },
      ],
    });

    const patterns = parseProviderPatterns(raw, "typescript", "general");

    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.language).toBe("javascript");
    expect(patterns[0]?.problemType).toBe("missing_try_catch");
    expect(patterns[0]?.confidence).toBe("high");
    expect(patterns[0]?.domain).toBe("general");
    expect(patterns[0]?.patternTags).toEqual(["async", "error-handling"]);
    expect(patterns[0]?.actionItems).toEqual(["Add try/catch"]);
  });

  it("parses fenced JSON and applies fallback defaults", () => {
    const raw = [
      "```json",
      JSON.stringify({
        patterns: [
          {
            question: "No loading state",
            answer: "Add a skeleton or spinner while fetching data.",
            domain: "ui",
            tags: ["ux"],
            actions: ["Add loading indicator"],
          },
        ],
      }),
      "```",
    ].join("\n");

    const patterns = parseProviderPatterns(raw, "typescript", "general");

    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.language).toBe("typescript");
    expect(patterns[0]?.problemType).toBe("detected_pattern");
    expect(patterns[0]?.domain).toBe("ui");
    expect(patterns[0]?.patternTags).toEqual(["ux"]);
    expect(patterns[0]?.actionItems).toEqual(["Add loading indicator"]);
  });

  it("parses nested JSON strings returned as message content", () => {
    const nested = JSON.stringify({
      patterns: [
        {
          language: "python",
          problemType: "Input Validation",
          question: "Request payload shape is unchecked",
          answer: "Validate payload schema before processing.",
          confidence: "medium",
          domain: "ai",
          patternTags: ["validation"],
          actionItems: ["Add schema guard"],
        },
      ],
    });

    const raw = JSON.stringify(nested);
    const patterns = parseProviderPatterns(raw, "typescript", "general");

    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.language).toBe("python");
    expect(patterns[0]?.domain).toBe("ai");
    expect(patterns[0]?.confidence).toBe("medium");
  });

  it("recovers from near-JSON malformed output", () => {
    const raw = [
      "model output start",
      '"language":"typescript"',
      '"problemType":"Prompt Injection Guard Missing"',
      '"question":"User prompt is passed directly to model tools"',
      '"answer":"Sanitize input and validate tool call results"',
      '"confidence":"low"',
      '"domain":"ai"',
      '"patternTags":["security","prompt-injection"]',
      '"actionItems":["Add sanitizer","Add output schema validation"]',
      "model output end",
    ].join("\n");

    const patterns = parseProviderPatterns(raw, "typescript", "general");

    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.problemType).toBe("prompt_injection_guard_missing");
    expect(patterns[0]?.domain).toBe("ai");
    expect(patterns[0]?.confidence).toBe("low");
    expect(patterns[0]?.patternTags).toEqual(["security", "prompt-injection"]);
    expect(patterns[0]?.actionItems).toEqual(["Add sanitizer", "Add output schema validation"]);
  });

  it("returns empty for non-JSON noise", () => {
    const patterns = parseProviderPatterns("provider timed out and returned plain text", "typescript", "general");
    expect(patterns).toEqual([]);
  });
});
