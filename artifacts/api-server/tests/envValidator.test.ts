import { afterEach, describe, expect, it, vi } from "vitest";
import { ollamaClient } from "../src/lib/ollamaClient";
import { validateEnv } from "../src/lib/envValidator";

type EnvSnapshot = {
  DB_PATH?: string;
  GROQ_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
};

function captureEnv(): EnvSnapshot {
  return {
    DB_PATH: process.env.DB_PATH,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };
}

function restoreEnv(snapshot: EnvSnapshot): void {
  if (snapshot.DB_PATH === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = snapshot.DB_PATH;

  if (snapshot.GROQ_API_KEY === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = snapshot.GROQ_API_KEY;

  if (snapshot.ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = snapshot.ANTHROPIC_API_KEY;
}

describe("validateEnv", () => {
  const originalEnv = captureEnv();

  afterEach(() => {
    vi.restoreAllMocks();
    restoreEnv(originalEnv);
  });

  it("prints unavailable provider state when Ollama is down", async () => {
    process.env.DB_PATH = "./data/test-city.db";
    delete process.env.GROQ_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    vi.spyOn(ollamaClient, "isAvailable").mockResolvedValue(false);
    const listModelsSpy = vi.spyOn(ollamaClient, "listModels").mockResolvedValue(["qwen2.5:0.5b"]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await validateEnv();

    const output = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(output).toContain("SQLite DB");
    expect(output).toContain("Ollama");
    expect(output).toContain("Unavailable (agents will escalate)");
    expect(output).toContain("GROQ_API_KEY");
    expect(output).toContain("Not set (optional)");

    expect(listModelsSpy).not.toHaveBeenCalled();
  });

  it("prints available provider and model count when Ollama is reachable", async () => {
    process.env.DB_PATH = "./data/test-city.db";
    process.env.GROQ_API_KEY = "groq-test-key";
    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";

    vi.spyOn(ollamaClient, "isAvailable").mockResolvedValue(true);
    vi.spyOn(ollamaClient, "listModels").mockResolvedValue(["qwen2.5:0.5b", "qwen2.5:1.5b"]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await validateEnv();

    const output = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(output).toContain("Available (2 models)");
    expect(output).toContain("GROQ_API_KEY");
    expect(output).toContain("ANTHROPIC_API_KEY");
    expect(output).toContain("Set");
  });
});
