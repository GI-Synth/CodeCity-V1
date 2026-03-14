import { spawn } from "node:child_process";

export type AlchemistExecutionStatus = "success" | "failed" | "blocked" | "timeout";

export interface AlchemistExecutionResult {
  command: string;
  status: AlchemistExecutionStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  reason?: string;
}

const OUTPUT_LIMIT = 32_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 5 * 60_000;
const SHELL_META_REGEX = /[;&|><`]/;
const DANGEROUS_TOKENS = new Set([
  "rm",
  "sudo",
  "shutdown",
  "reboot",
  "kill",
  "killall",
  "mkfs",
  "dd",
  "launchctl",
  "chmod",
  "chown",
]);

function clampTimeout(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS;
  const numeric = Number(timeoutMs);
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, numeric));
}

function appendOutput(current: string, chunk: string): string {
  if (current.length >= OUTPUT_LIMIT) return current;
  const combined = `${current}${chunk}`;
  if (combined.length <= OUTPUT_LIMIT) return combined;
  return combined.slice(0, OUTPUT_LIMIT);
}

function tokenize(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
}

function allowedByPolicy(tokens: string[]): { allowed: boolean; reason?: string } {
  if (tokens.length === 0) return { allowed: false, reason: "empty command" };

  const executable = tokens[0].toLowerCase();
  if (DANGEROUS_TOKENS.has(executable)) {
    return { allowed: false, reason: `${executable} is blocked` };
  }

  if (executable === "pnpm") {
    const allowedScripts = new Set(["typecheck", "test", "lint", "build"]);
    const runIndex = tokens.indexOf("run");
    if (runIndex >= 0 && tokens[runIndex + 1] && allowedScripts.has(tokens[runIndex + 1])) {
      return { allowed: true };
    }
    const directScript = tokens.find(token => allowedScripts.has(token));
    if (directScript) return { allowed: true };
    return { allowed: false, reason: "pnpm command must run typecheck/test/lint/build" };
  }

  if (executable === "npm") {
    if (tokens[1] === "run" && ["typecheck", "test", "lint", "build"].includes(tokens[2] ?? "")) {
      return { allowed: true };
    }
    return { allowed: false, reason: "npm command must be npm run typecheck/test/lint/build" };
  }

  if (executable === "git") {
    const gitAction = tokens[1] ?? "";
    if (["status", "diff", "log", "show", "rev-parse", "branch"].includes(gitAction)) {
      return { allowed: true };
    }
    return { allowed: false, reason: "only read-only git commands are allowed" };
  }

  if (executable === "node" && (tokens[1] === "-v" || tokens[1] === "--version")) {
    return { allowed: true };
  }

  return { allowed: false, reason: `command '${tokens[0]}' is not in the allow list` };
}

export async function runAlchemistCommand(params: {
  command: string;
  timeoutMs?: number;
  cwd?: string;
}): Promise<AlchemistExecutionResult> {
  const command = (params.command ?? "").trim();
  const startedAtIso = new Date().toISOString();
  const start = Date.now();

  if (!command) {
    return {
      command,
      status: "blocked",
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: 0,
      startedAt: startedAtIso,
      finishedAt: startedAtIso,
      reason: "Command is required",
    };
  }

  if (SHELL_META_REGEX.test(command)) {
    const finishedAt = new Date().toISOString();
    return {
      command,
      status: "blocked",
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: Date.now() - start,
      startedAt: startedAtIso,
      finishedAt,
      reason: "Shell metacharacters are not allowed",
    };
  }

  const tokens = tokenize(command);
  const policy = allowedByPolicy(tokens);
  if (!policy.allowed) {
    const finishedAt = new Date().toISOString();
    return {
      command,
      status: "blocked",
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: Date.now() - start,
      startedAt: startedAtIso,
      finishedAt,
      reason: policy.reason ?? "Blocked by policy",
    };
  }

  const timeoutMs = clampTimeout(params.timeoutMs);
  const executable = tokens[0];
  const args = tokens.slice(1);

  return await new Promise<AlchemistExecutionResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;
    let timedOut = false;
    let settled = false;

    const child = spawn(executable, args, {
      cwd: params.cwd ?? process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500).unref();
    }, timeoutMs);

    const finalize = (status: AlchemistExecutionStatus, reason?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const finishedAt = new Date().toISOString();
      resolve({
        command,
        status,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - start,
        startedAt: startedAtIso,
        finishedAt,
        reason,
      });
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout = appendOutput(stdout, chunk.toString());
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr = appendOutput(stderr, chunk.toString());
    });

    child.on("error", (error) => {
      stderr = appendOutput(stderr, error.message);
      finalize("failed", error.message);
    });

    child.on("close", (code) => {
      exitCode = typeof code === "number" ? code : null;
      if (timedOut) {
        finalize("timeout", `Command exceeded timeout (${timeoutMs}ms)`);
        return;
      }

      if (exitCode === 0) {
        finalize("success");
      } else {
        finalize("failed", `Command exited with code ${exitCode ?? "unknown"}`);
      }
    });
  });
}
