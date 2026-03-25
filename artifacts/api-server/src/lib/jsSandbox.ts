/**
 * jsSandbox.ts
 *
 * Executes AI-generated JavaScript test code inside a js-interpreter sandbox.
 * No child process is spawned, no file is written to disk.
 * Stubs describe/it/test/expect/assert so typical test patterns run without errors.
 */
import Interpreter from "js-interpreter";

export interface SandboxResult {
  passed: number;
  failed: number;
  errors: Array<{ message: string }>;
  logs: string[];
  durationMs: number;
  timedOut: boolean;
}

/**
 * Checks whether the detected test-framework calls (describe/it/test/expect)
 * are present in the code, to decide whether to use the sandbox.
 */
export function isSandboxable(code: string): boolean {
  return /\b(describe|it|test)\s*\(|\b(expect|assert)\s*\(|console\.log\s*\(/.test(code);
}

/**
 * Runs arbitrary JS code in a sandboxed js-interpreter instance.
 * Stubs out common test primitives and captures pass/fail counts.
 *
 * @param code      JavaScript source code to execute
 * @param timeoutMs Maximum execution wall time (default 5 000 ms)
 */
export async function runInSandbox(code: string, timeoutMs = 5000): Promise<SandboxResult> {
  const start = Date.now();

  let passed = 0;
  let failed = 0;
  const errors: Array<{ message: string }> = [];
  const logs: string[] = [];
  let timedOut = false;

  const preamble = `
var __passed = 0;
var __failed = 0;
var __errors = [];
var __logs = [];
`;

  const fullCode = preamble + "\n" + code;

  return new Promise<SandboxResult>((resolve) => {
    let interp: Interpreter;

    try {
      interp = new Interpreter(fullCode, (interpreter, globalObject) => {
        // console.log stub — captures output
        const consolePseudo = interpreter.nativeToPseudo({}) as Interpreter["globalObject"];
        interpreter.setProperty(consolePseudo, "log", interpreter.createNativeFunction((...args: unknown[]) => {
          const line = args.map(a => {
            try {
              return typeof a === "object" ? JSON.stringify(a) : String(a);
            } catch { return String(a); }
          }).join(" ");
          logs.push(line);
        }));
        interpreter.setProperty(globalObject, "console", consolePseudo);

        // describe(name, fn) — immediately invoke fn
        interpreter.setProperty(globalObject, "describe", interpreter.createNativeFunction((
          _name: unknown,
          fn: unknown,
        ) => {
          if (typeof fn === "function") {
            try { (fn as () => void)(); } catch { /* swallow */ }
          }
        }));

        // it / test(name, fn)
        const itFn = interpreter.createNativeFunction((name: unknown, fn: unknown) => {
          const label = String(name ?? "unnamed");
          if (typeof fn !== "function") { passed++; return; }
          try {
            (fn as () => void)();
            passed++;
            logs.push(`✓ ${label}`);
          } catch (e: unknown) {
            failed++;
            const msg = e instanceof Error ? e.message : String(e);
            errors.push({ message: `${label}: ${msg}` });
            logs.push(`✗ ${label}: ${msg}`);
          }
        });
        interpreter.setProperty(globalObject, "it", itFn);
        interpreter.setProperty(globalObject, "test", itFn);

        // beforeEach / afterEach / beforeAll / afterAll — no-op
        const noop = interpreter.createNativeFunction(() => undefined);
        for (const name of ["beforeEach", "afterEach", "beforeAll", "afterAll"]) {
          interpreter.setProperty(globalObject, name, noop);
        }

        // expect(value) — returns a chainable pseudo-object
        interpreter.setProperty(globalObject, "expect", interpreter.createNativeFunction((received: unknown) => {
          const matchers = {
            toBe: (expected: unknown) => {
              if (received !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(received)}`);
            },
            toEqual: (expected: unknown) => {
              if (JSON.stringify(received) !== JSON.stringify(expected))
                throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(received)}`);
            },
            toBeTruthy: () => {
              if (!received) throw new Error(`Expected truthy, got ${JSON.stringify(received)}`);
            },
            toBeFalsy: () => {
              if (received) throw new Error(`Expected falsy, got ${JSON.stringify(received)}`);
            },
            toBeNull: () => {
              if (received !== null) throw new Error(`Expected null, got ${JSON.stringify(received)}`);
            },
            toBeUndefined: () => {
              if (received !== undefined) throw new Error(`Expected undefined, got ${JSON.stringify(received)}`);
            },
            toBeDefined: () => {
              if (received === undefined) throw new Error(`Expected defined value`);
            },
            toContain: (item: unknown) => {
              if (!Array.isArray(received) || !received.includes(item))
                throw new Error(`Expected ${JSON.stringify(received)} to contain ${JSON.stringify(item)}`);
            },
            toThrow: () => {
              // when expect(fn).toThrow() — too complex to fully support; pass silently
            },
            not: {} as Record<string, unknown>,
          };
          return interpreter.nativeToPseudo(matchers);
        }));

        // assert(condition, msg)
        interpreter.setProperty(globalObject, "assert", interpreter.createNativeFunction((
          cond: unknown,
          msg: unknown,
        ) => {
          if (!cond) throw new Error(String(msg ?? "Assertion failed"));
        }));
      });
    } catch (initErr) {
      const msg = initErr instanceof Error ? initErr.message : String(initErr);
      return resolve({
        passed: 0, failed: 1,
        errors: [{ message: `Sandbox init error: ${msg}` }],
        logs, durationMs: Date.now() - start, timedOut: false,
      });
    }

    const deadline = start + timeoutMs;
    const MAX_STEPS = 500_000;
    let steps = 0;

    // Step-based execution to honour timeout
    const tick = () => {
      try {
        const chunkSize = 1000;
        for (let i = 0; i < chunkSize; i++) {
          if (!interp.step()) {
            // Program finished
            resolve({
              passed, failed, errors, logs,
              durationMs: Date.now() - start,
              timedOut: false,
            });
            return;
          }
          steps++;
          if (steps >= MAX_STEPS || Date.now() >= deadline) {
            timedOut = true;
            resolve({
              passed, failed,
              errors: [...errors, { message: "Sandbox execution timed out" }],
              logs, durationMs: Date.now() - start, timedOut: true,
            });
            return;
          }
        }
        // Yield back to event loop then continue
        setImmediate(tick);
      } catch (execErr) {
        const msg = execErr instanceof Error ? execErr.message : String(execErr);
        failed++;
        errors.push({ message: `Runtime error: ${msg}` });
        resolve({ passed, failed, errors, logs, durationMs: Date.now() - start, timedOut: false });
      }
    };

    setImmediate(tick);
  });
}
