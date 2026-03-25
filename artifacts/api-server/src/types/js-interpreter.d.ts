/**
 * Minimal TypeScript declarations for the js-interpreter package (v6).
 * Only the subset used by jsSandbox.ts is declared here.
 */
declare module "js-interpreter" {
  type InitFunc = (interpreter: Interpreter, globalObject: InterpreterObject) => void;

  interface InterpreterObject {
    [key: string]: unknown;
  }

  class Interpreter {
    constructor(code: string, initFunc?: InitFunc);
    /** Run to completion. Returns true if paused, false if finished. */
    run(): boolean;
    /** Execute a single step. Returns false when the program has finished. */
    step(): boolean;
    /** The global scope object. */
    globalObject: InterpreterObject;
    getProperty(obj: InterpreterObject, name: string): unknown;
    setProperty(obj: InterpreterObject, name: string, value: unknown, descriptor?: unknown): void;
    createNativeFunction(fn: (...args: unknown[]) => unknown, isConstructor?: boolean): unknown;
    nativeToPseudo(value: unknown): unknown;
    pseudoToNative(value: unknown): unknown;
  }

  export = Interpreter;
}
