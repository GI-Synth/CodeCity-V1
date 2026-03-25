import { afterEach, describe, expect, it } from "vitest";
import { ollamaClient } from "../src/lib/ollamaClient";

type EnvSnapshot = {
  OLLAMA_HOST?: string;
};

function captureEnv(): EnvSnapshot {
  return {
    OLLAMA_HOST: process.env.OLLAMA_HOST,
  };
}

function restoreEnv(snapshot: EnvSnapshot): void {
  if (snapshot.OLLAMA_HOST === undefined) {
    delete process.env.OLLAMA_HOST;
    return;
  }

  process.env.OLLAMA_HOST = snapshot.OLLAMA_HOST;
}

describe("ollamaClient.getHost", () => {
  const originalEnv = captureEnv();

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  it("normalizes configured hosts by trimming trailing slashes", () => {
    process.env.OLLAMA_HOST = "http://example.local:11434///";

    expect(ollamaClient.getHost()).toBe("http://example.local:11434");
  });

  it("falls back to localhost when OLLAMA_HOST is blank", () => {
    process.env.OLLAMA_HOST = "   ";

    expect(ollamaClient.getHost()).toBe("http://localhost:11434");
  });
});
