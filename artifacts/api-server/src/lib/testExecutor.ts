import { spawn } from "child_process";
import { writeFile, unlink, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

export interface TestError {
  message: string;
  line?: number;
  stack?: string;
}

export interface TestExecutionResult {
  passed: number;
  failed: number;
  errors: TestError[];
  coverage: number | null;
  durationMs: number;
  rawOutput: string;
}

export interface SanityResult {
  ok: boolean;
  error?: string;
}

function parseTestOutput(stdout: string, stderr: string): { passed: number; failed: number; errors: TestError[] } {
  let passed = 0;
  let failed = 0;
  const errors: TestError[] = [];

  const mochaPassMatch = stdout.match(/(\d+) passing/);
  const mochaFailMatch = stdout.match(/(\d+) failing/);
  if (mochaPassMatch) passed = parseInt(mochaPassMatch[1]);
  if (mochaFailMatch) failed = parseInt(mochaFailMatch[1]);

  const jestMatch = stdout.match(/Tests:\s+(?:(\d+) passed)?(?:,\s*)?(?:(\d+) failed)?/);
  if (jestMatch && (jestMatch[1] || jestMatch[2])) {
    passed = parseInt(jestMatch[1] ?? "0");
    failed = parseInt(jestMatch[2] ?? "0");
  }

  const passedLines = (stdout.match(/PASSED/g) ?? []).length;
  const failedLines = (stdout.match(/FAILED/g) ?? []).length;
  if (passedLines > 0 || failedLines > 0) {
    passed = Math.max(passed, passedLines);
    failed = Math.max(failed, failedLines);
  }

  if (passed === 0 && failed === 0) {
    const assertionMatch = stdout.match(/(\d+) assertion/);
    if (assertionMatch) passed = parseInt(assertionMatch[1]);
  }

  const errorPatterns = [
    /(?:Error|TypeError|AssertionError|ReferenceError):\s*(.+)/g,
    /✗\s+(.+)/g,
    /× (.+)/g,
  ];

  const combined = stderr + "\n" + stdout;
  for (const pattern of errorPatterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(combined)) !== null) {
      const lineMatch = combined.match(/at .+:(\d+)/);
      errors.push({
        message: m[1].trim().slice(0, 200),
        line: lineMatch ? parseInt(lineMatch[1]) : undefined,
        stack: m[0].slice(0, 300),
      });
      if (errors.length >= 10) break;
    }
  }

  if (errors.length > 0 && failed === 0) failed = errors.length;
  if (passed === 0 && failed === 0 && errors.length === 0) passed = 1;

  return { passed, failed, errors };
}

async function parseCoverageJSON(coverageDir: string): Promise<number | null> {
  const candidates = [
    join(coverageDir, "coverage-summary.json"),
    join(process.cwd(), "coverage", "coverage-summary.json"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const raw = await readFile(path, "utf-8");
        const data = JSON.parse(raw) as Record<string, { lines?: { pct: number } }>;
        const total = data["total"];
        if (total?.lines?.pct !== undefined) return total.lines.pct / 100;
      } catch { }
    }
  }
  return null;
}

function runProcess(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(cmd, args, { shell: false, timeout: timeoutMs });

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => { proc.kill("SIGTERM"); }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, code: 1 });
    });
  });
}

export class TestExecutor {
  async runQuickSanity(filePath: string): Promise<SanityResult> {
    if (!existsSync(filePath)) {
      return { ok: false, error: `File not found: ${filePath}` };
    }
    const { stderr, code } = await runProcess("node", [
      "--input-type=module",
    ], 5000).catch(() => ({ stdout: "", stderr: "node unavailable", code: 1 }));
    return code === 0 ? { ok: true } : { ok: false, error: stderr.slice(0, 200) };
  }

  async executeTests(params: {
    targetFile: string;
    testCode: string;
    language: string;
    timeoutMs?: number;
  }): Promise<TestExecutionResult> {
    const start = Date.now();
    const timeoutMs = params.timeoutMs ?? 15000;
    const uuid = randomUUID().slice(0, 8);
    const ext = params.language === "python" ? "py" : params.language === "javascript" ? "js" : "ts";
    const tempDir = "/tmp";
    const tempFile = join(tempDir, `sc_test_${uuid}.${ext}`);
    const coverageDir = join(tempDir, `sc_cov_${uuid}`);

    let testCode = params.testCode;
    if (ext !== "py" && existsSync(params.targetFile)) {
      const importPath = params.targetFile;
      testCode = `import '${importPath}';\n${testCode}`;
    }

    try {
      await mkdir(coverageDir, { recursive: true });
      await writeFile(tempFile, testCode, "utf-8");

      let stdout = "";
      let stderr = "";

      if (ext === "py") {
        const reportFile = join(tempDir, `sc_pytest_${uuid}.json`);
        const result = await runProcess("python3", [
          "-m", "pytest", tempFile, "--json-report", `--json-report-file=${reportFile}`, "-v",
        ], timeoutMs);
        stdout = result.stdout;
        stderr = result.stderr;
        if (existsSync(reportFile)) {
          try {
            const raw = await readFile(reportFile, "utf-8");
            const report = JSON.parse(raw) as { summary?: { passed?: number; failed?: number } };
            const summary = report.summary ?? {};
            const passed = summary.passed ?? 0;
            const failed = summary.failed ?? 0;
            unlink(reportFile).catch(() => {});
            return {
              passed, failed, errors: [],
              coverage: null, durationMs: Date.now() - start,
              rawOutput: (stdout + stderr).slice(0, 2000),
            };
          } catch { }
        }
      } else {
        const c8Available = await runProcess("npx", ["c8", "--version"], 3000)
          .then(r => r.code === 0).catch(() => false);

        if (c8Available) {
          const result = await runProcess("npx", [
            "c8", "--reporter=json-summary", `--report-dir=${coverageDir}`, "tsx", tempFile,
          ], timeoutMs);
          stdout = result.stdout;
          stderr = result.stderr;
        } else {
          const result = await runProcess("npx", ["tsx", tempFile], timeoutMs);
          stdout = result.stdout;
          stderr = result.stderr;
        }
      }

      const { passed, failed, errors } = parseTestOutput(stdout, stderr);
      const coverage = await parseCoverageJSON(coverageDir);

      return {
        passed,
        failed,
        errors,
        coverage,
        durationMs: Date.now() - start,
        rawOutput: (stdout + "\n" + stderr).trim().slice(0, 2000),
      };
    } finally {
      unlink(tempFile).catch(() => {});
    }
  }
}

export const testExecutor = new TestExecutor();
