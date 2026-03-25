/**
 * Tests for the specialized agent system (Part 3), console log agent (Part 5),
 * analysis tools (Part 9), and agent message bus types.
 */
import { describe, it, expect } from "vitest";
import {
  SPECIALIZED_ROLES,
  mapRoleToPersona,
  personaEmoji,
  buildRolePrompt,
  parseRoleResponse,
  isSpecializedRole,
  getSpecializedRole,
  type AgentPersona,
} from "../src/lib/smartAgents";

import {
  parseLogLine,
  type LogLevel,
} from "../src/lib/consoleLogAgent";

import {
  analyzeComplexity,
  analyzeSecurityFile,
  analyzeDocumentation,
  analyzeArchitecture,
} from "../src/lib/analysisTools";

// ── Part 3: Specialized Agent System Tests ───────────────────────────────────

describe("Specialized Agent System", () => {
  it("has exactly 6 specialized roles", () => {
    expect(SPECIALIZED_ROLES.length).toBe(6);
  });

  it("each role has required fields", () => {
    for (const role of SPECIALIZED_ROLES) {
      expect(role.id).toBeTruthy();
      expect(role.name).toBeTruthy();
      expect(role.emoji).toBeTruthy();
      expect(role.persona).toBeTruthy();
      expect(role.focus).toBeTruthy();
      expect(role.domains.length).toBeGreaterThan(0);
    }
  });

  it("isSpecializedRole correctly identifies new roles", () => {
    expect(isSpecializedRole("architect")).toBe(true);
    expect(isSpecializedRole("security")).toBe(true);
    expect(isSpecializedRole("performance")).toBe(true);
    expect(isSpecializedRole("quality")).toBe(true);
    expect(isSpecializedRole("documentation")).toBe(true);
    expect(isSpecializedRole("console_log")).toBe(true);
    // Legacy roles are NOT specialized
    expect(isSpecializedRole("qa_inspector")).toBe(false);
    expect(isSpecializedRole("scribe")).toBe(false);
  });

  it("getSpecializedRole looks up by id", () => {
    const sec = getSpecializedRole("security");
    expect(sec).toBeDefined();
    expect(sec!.name).toBe("Security Agent");
    expect(sec!.persona).toBe("guardian");
  });

  it("mapRoleToPersona handles new specialized roles", () => {
    expect(mapRoleToPersona("security")).toBe("guardian");
    expect(mapRoleToPersona("performance")).toBe("optimizer");
    expect(mapRoleToPersona("quality")).toBe("quality");
    expect(mapRoleToPersona("documentation")).toBe("documentation");
    expect(mapRoleToPersona("console_log")).toBe("console_log");
  });

  it("mapRoleToPersona still handles legacy roles", () => {
    expect(mapRoleToPersona("qa_inspector")).toBe("inspector");
    expect(mapRoleToPersona("api_fuzzer")).toBe("guardian");
    expect(mapRoleToPersona("load_tester")).toBe("optimizer");
    expect(mapRoleToPersona("edge_explorer")).toBe("architect");
    expect(mapRoleToPersona("scribe")).toBe("scribe");
    expect(mapRoleToPersona("alchemist")).toBe("alchemist");
  });

  it("personaEmoji returns unique emoji for each persona", () => {
    const personas: AgentPersona[] = [
      "inspector", "guardian", "optimizer", "architect", "scribe",
      "quality", "documentation", "console_log",
    ];
    const emojis = personas.map(p => personaEmoji(p));
    const unique = new Set(emojis);
    expect(unique.size).toBe(personas.length);
  });

  it("buildRolePrompt returns prompts for new personas", () => {
    const params = {
      language: "typescript",
      filePath: "src/test.ts",
      codeSnippet: "function test() { return 1; }",
    };

    const qualityPrompt = buildRolePrompt({ persona: "quality", ...params });
    expect(qualityPrompt).not.toBeNull();
    expect(qualityPrompt!.expects).toBe("bug");
    expect(qualityPrompt!.system).toContain("quality");

    const docPrompt = buildRolePrompt({ persona: "documentation", ...params });
    expect(docPrompt).not.toBeNull();
    expect(docPrompt!.expects).toBe("bug");
    expect(docPrompt!.system).toContain("documentation");

    const logPrompt = buildRolePrompt({ persona: "console_log", ...params });
    expect(logPrompt).not.toBeNull();
    expect(logPrompt!.expects).toBe("bug");
    expect(logPrompt!.system).toContain("runtime");
  });

  it("buildRolePrompt still returns null for alchemist", () => {
    const result = buildRolePrompt({
      persona: "alchemist",
      language: "typescript",
      filePath: "src/test.ts",
      codeSnippet: "const x = 1;",
    });
    expect(result).toBeNull();
  });
});

// ── Part 5: Console Log Agent Tests ──────────────────────────────────────────

describe("Console Log Agent - parseLogLine", () => {
  it("classifies error logs", () => {
    const result = parseLogLine("[Error] Something broke at /src/index.ts:42");
    expect(result.level).toBe("error");
    expect(result.message).toContain("Something broke");
  });

  it("classifies warning logs", () => {
    const result = parseLogLine("[warn] Deprecated function used");
    expect(result.level).toBe("warn");
  });

  it("classifies performance timing logs", () => {
    const result = parseLogLine("[perf] query elapsed: 250ms");
    expect(result.level).toBe("perf");
    expect(result.perfDuration).toBe(250);
  });

  it("classifies info logs", () => {
    const result = parseLogLine("Server listening on port 3000");
    expect(result.level).toBe("info");
  });

  it("extracts file and line from stack traces", () => {
    const log = `TypeError: Cannot read properties of null
    at /src/lib/data.ts:87:12
    at /src/index.ts:10:5`;
    const result = parseLogLine(log);
    expect(result.level).toBe("error");
    expect(result.file).toContain("data.ts");
    expect(result.stackTrace).toContain("at ");
  });

  it("extracts error type", () => {
    const result = parseLogLine("TypeError: something failed");
    expect(result.errorType).toBe("TypeError");
  });

  it("caps raw output length", () => {
    const longLog = "error: " + "x".repeat(5000);
    const result = parseLogLine(longLog);
    expect(result.raw.length).toBeLessThanOrEqual(2000);
    expect(result.message.length).toBeLessThanOrEqual(500);
  });
});

// ── Part 9: Analysis Tools Tests ─────────────────────────────────────────────

describe("Analysis Tools - Complexity", () => {
  it("computes basic file complexity", () => {
    const code = `
export function hello(name: string): string {
  if (name) {
    return "Hello " + name;
  }
  return "Hello World";
}

export function add(a: number, b: number): number {
  return a + b;
}
`;
    const result = analyzeComplexity("/test.ts", code);
    expect(result.loc).toBeGreaterThan(0);
    expect(result.fileComplexity).toBeGreaterThanOrEqual(2); // 1 base + at least 1 branch
    expect(result.functions.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty for missing file", () => {
    const result = analyzeComplexity("/nonexistent.ts");
    expect(result.loc).toBe(0);
    expect(result.functions).toEqual([]);
  });
});

describe("Analysis Tools - Security", () => {
  it("detects hardcoded secrets", () => {
    const code = `const password = "supersecret123456";`;
    const findings = analyzeSecurityFile("/test.ts", code);
    expect(findings.some(f => f.rule === "hardcoded-secret")).toBe(true);
  });

  it("detects eval usage", () => {
    const code = `const result = eval(userInput);`;
    const findings = analyzeSecurityFile("/test.ts", code);
    expect(findings.some(f => f.rule === "eval-usage")).toBe(true);
  });

  it("detects innerHTML assignment", () => {
    const code = `element.innerHTML = userContent;`;
    const findings = analyzeSecurityFile("/test.ts", code);
    expect(findings.some(f => f.rule === "innerhtml")).toBe(true);
  });

  it("returns empty for clean code", () => {
    const code = `export function add(a: number, b: number): number { return a + b; }`;
    const findings = analyzeSecurityFile("/test.ts", code);
    expect(findings.length).toBe(0);
  });
});

describe("Analysis Tools - Documentation", () => {
  it("detects undocumented exports", () => {
    const code = `export function undocumentedFn(): void { }`;
    const gaps = analyzeDocumentation("/test.ts", code);
    expect(gaps.some(g => g.type === "undocumented-export" && g.functionName === "undocumentedFn")).toBe(true);
  });

  it("does not flag documented exports", () => {
    const code = `/** Does something important. */
export function documentedFn(): void { }`;
    const gaps = analyzeDocumentation("/test.ts", code);
    expect(gaps.filter(g => g.functionName === "documentedFn")).toHaveLength(0);
  });

  it("detects TODO comments", () => {
    const code = `// TODO: fix this later\nconst x = 1;`;
    const gaps = analyzeDocumentation("/test.ts", code);
    expect(gaps.some(g => g.type === "stale-todo")).toBe(true);
  });
});

describe("Analysis Tools - Architecture", () => {
  it("detects god objects", () => {
    // 20 exports across 600 lines
    const exports = Array.from({ length: 20 }, (_, i) => `export function fn${i}(): void { }`);
    const lines = Array.from({ length: 500 }, () => "// padding");
    const code = [...exports, ...lines].join("\n");
    const smells = analyzeArchitecture("/test.ts", code);
    expect(smells.some(s => s.type === "god-object")).toBe(true);
  });

  it("detects high coupling", () => {
    const imports = Array.from({ length: 20 }, (_, i) => `import { x${i} } from "./mod${i}";`);
    const code = imports.join("\n") + "\nexport const y = 1;";
    const smells = analyzeArchitecture("/test.ts", code);
    expect(smells.some(s => s.type === "high-coupling")).toBe(true);
  });

  it("returns empty for simple file", () => {
    const code = `export const x = 1;`;
    const smells = analyzeArchitecture("/test.ts", code);
    expect(smells).toHaveLength(0);
  });
});
