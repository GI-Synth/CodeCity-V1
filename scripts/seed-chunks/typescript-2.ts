import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "Missing strictFunctionTypes in tsconfig",
      content: "Without strictFunctionTypes, function parameter types are checked bivariantly, allowing unsafe assignments. Enable it to catch bugs where callback parameter types don't match expected signatures.",
      domain: "typescript", problemType: "strict_config", severity: "medium", confidence: 0.82,
      tags: ["strictFunctionTypes", "config", "bivariant", "callback"],
    },
    {
      title: "String literal union without exhaustive map",
      content: "When mapping string unions to values, a plain object lookup can miss new members. Use `Record<MyUnion, ValueType>` to get compile-time errors when adding new union members without updating the map.",
      domain: "typescript", problemType: "exhaustive_map", severity: "medium", confidence: 0.85,
      tags: ["record", "exhaustive", "map", "union"],
    },
    {
      title: "Async function without await",
      content: "Marking a function `async` without any `await` inside it wraps the return in an unnecessary Promise. Either add explicit async operations or remove the async keyword. Check for forgotten awaits on async calls.",
      domain: "typescript", problemType: "async_without_await", severity: "low", confidence: 0.85,
      tags: ["async", "await", "promise", "unnecessary"],
    },
    {
      title: "Optional parameters before required ones",
      content: "TypeScript allows `fn(a?: string, b: number)` but callers must pass undefined explicitly for the optional param. Put required parameters first: `fn(b: number, a?: string)` or use an options object.",
      domain: "typescript", problemType: "parameter_order", severity: "low", confidence: 0.85,
      tags: ["optional", "parameter", "order", "api"],
    },
    {
      title: "Missing readonly modifier on class properties",
      content: "Class properties that should be set once in the constructor but are writable allow accidental mutation. Use `readonly` keyword for properties set in constructor: `readonly id: string`.",
      domain: "typescript", problemType: "readonly_class", severity: "low", confidence: 0.82,
      tags: ["readonly", "class", "property", "immutable"],
    },
    {
      title: "Promise<void> not awaited (fire and forget)",
      content: "Calling an async function without await loses errors silently. Either await the promise, add .catch() for error handling, or use void operator `void myAsync()` to signal intentional fire-and-forget.",
      domain: "typescript", problemType: "floating_promise", severity: "high", confidence: 0.90,
      tags: ["promise", "await", "floating", "error-handling"],
    },
    {
      title: "Overloaded function with inconsistent behavior",
      content: "Function overloads that behave differently based on parameter types are surprising. Each overload should have consistent semantics. Prefer discriminated union parameters over function overloads for complex cases.",
      domain: "typescript", problemType: "overload", severity: "low", confidence: 0.80,
      tags: ["overload", "consistency", "union", "parameter"],
    },
    {
      title: "Index signature allowing undefined values",
      content: "`{ [key: string]: string }` claims every key maps to a string, but lookups return string even for missing keys. Use Map or enable noUncheckedIndexedAccess to get `string | undefined`.",
      domain: "typescript", problemType: "index_undefined", severity: "medium", confidence: 0.82,
      tags: ["index", "undefined", "map", "safety"],
    },
    {
      title: "Barrel file re-exports causing circular imports",
      content: "Index.ts barrel files that re-export everything can create import cycles when modules in the same directory import from each other via the barrel. Import directly from the source file to break cycles.",
      domain: "typescript", problemType: "barrel_circular", severity: "medium", confidence: 0.85,
      tags: ["barrel", "index", "circular", "import"],
    },
    {
      title: "Window/document access without SSR guard",
      content: "Accessing `window` or `document` directly fails during server-side rendering. Guard with `typeof window !== 'undefined'` or use useEffect for browser-only code in React SSR apps.",
      domain: "typescript", problemType: "ssr_guard", severity: "medium", confidence: 0.85,
      tags: ["window", "ssr", "document", "guard"],
    },
    {
      title: "Using constructor function instead of class syntax",
      content: "Old-style constructor functions with prototype assignments are harder to type and understand than ES6 classes. Use class syntax with proper TypeScript typing for better IDE support and type checking.",
      domain: "typescript", problemType: "constructor_function", severity: "low", confidence: 0.80,
      tags: ["class", "constructor", "prototype", "syntax"],
    },
    {
      title: "Incorrect use of typeof for type narrowing",
      content: "`typeof null === 'object'` is a known JavaScript quirk. For null checks, use `=== null` explicitly. For objects, check `typeof x === 'object' && x !== null` to properly narrow.",
      domain: "typescript", problemType: "typeof_narrowing", severity: "medium", confidence: 0.85,
      tags: ["typeof", "narrowing", "null", "guard"],
    },
    {
      title: "Missing abstract class for shared base behavior",
      content: "Duplicating common methods across related classes violates DRY. Use abstract classes to define shared behavior and require subclasses to implement specific methods. Prefer composition for cross-cutting concerns.",
      domain: "typescript", problemType: "abstract_class", severity: "low", confidence: 0.80,
      tags: ["abstract", "class", "inheritance", "shared"],
    },
    {
      title: "Unnecessary type assertions in test files",
      content: "Test files using `as any` or `as unknown as Type` to create test data bypass type safety. Use proper factory functions or builders that create fully-typed test objects with sensible defaults.",
      domain: "typescript", problemType: "test_assertions", severity: "low", confidence: 0.82,
      tags: ["test", "assertion", "factory", "mock"],
    },
    {
      title: "Using delete operator instead of undefined assignment",
      content: "`delete obj.prop` changes object shape, deoptimizing V8. Assign undefined: `obj.prop = undefined` for optional properties, or use Map for dynamic keys. Only use delete on plain data objects.",
      domain: "typescript", problemType: "delete_operator", severity: "low", confidence: 0.80,
      tags: ["delete", "undefined", "performance", "v8"],
    },
    {
      title: "Missing readonly tuple types",
      content: "Function returning `[string, number]` allows mutation: `result[0] = 'hack'`. Use `readonly [string, number]` for tuples that should not be modified after creation, especially from hooks.",
      domain: "typescript", problemType: "readonly_tuple", severity: "low", confidence: 0.80,
      tags: ["readonly", "tuple", "immutable", "hook"],
    },
    {
      title: "Using private keyword instead of # prefix",
      content: "TypeScript `private` is only compile-time; the field is accessible at runtime. Use `#field` (ECMAScript private fields) for true runtime privacy. Use private for convention-only privacy.",
      domain: "typescript", problemType: "private_field", severity: "low", confidence: 0.80,
      tags: ["private", "hash", "ecmascript", "runtime"],
    },
    {
      title: "Incorrect Promise.all error handling",
      content: "Promise.all rejects on first failure, losing results of successful promises. Use Promise.allSettled when you need all results regardless of individual failures, then check status of each.",
      domain: "typescript", problemType: "promise_all", severity: "medium", confidence: 0.88,
      tags: ["promise", "allSettled", "error", "parallel"],
    },
    {
      title: "Missing template literal types for string patterns",
      content: "Using strings for formatted values like 'user-123' loses pattern information. TypeScript template literal types can enforce patterns: `type UserId = \\`user-\\${number}\\`` catches 'user-abc' at compile time.",
      domain: "typescript", problemType: "template_literal", severity: "low", confidence: 0.80,
      tags: ["template-literal", "pattern", "string", "validation"],
    },
    {
      title: "Excessive type narrowing with multiple if checks",
      content: "Cascading if/else type guards are noisy. Use discriminated unions with switch, early-return patterns, or assertion function: `function assertUser(v: unknown): asserts v is User` for cleaner narrowing.",
      domain: "typescript", problemType: "narrowing_style", severity: "low", confidence: 0.80,
      tags: ["narrowing", "discriminated", "switch", "assertion"],
    },
    {
      title: "Ambient declaration file (.d.ts) with side effects",
      content: ".d.ts files should only contain type declarations, never runtime code. Side effects in .d.ts files are ignored by the compiler but can confuse tooling. Move runtime code to .ts files.",
      domain: "typescript", problemType: "ambient_side_effects", severity: "low", confidence: 0.82,
      tags: ["declaration", "dts", "ambient", "side-effect"],
    },
    {
      title: "Redundant type declarations on inferred variables",
      content: "`const name: string = 'hello'` or `const nums: number[] = [1, 2, 3]` adds noise when types are trivially inferred. Let TypeScript infer obvious types; annotate complex or public-API types.",
      domain: "typescript", problemType: "redundant_type", severity: "low", confidence: 0.82,
      tags: ["inference", "redundant", "annotation", "noise"],
    },
    {
      title: "Using Function type instead of specific callable",
      content: "`Function` type accepts any callable with no parameter or return type checking. Use specific signatures: `(a: string) => void` or `(...args: unknown[]) => unknown` for maximum type safety.",
      domain: "typescript", problemType: "function_type", severity: "medium", confidence: 0.85,
      tags: ["function", "callable", "signature", "type"],
    },
    {
      title: "Mixed CommonJS and ESM imports in same file",
      content: "Using both `import x from 'y'` and `const z = require('w')` in the same file breaks module consistency. Standardize on ESM (import/export) or CJS (require/module.exports) per project.",
      domain: "typescript", problemType: "module_mixing", severity: "medium", confidence: 0.85,
      tags: ["esm", "commonjs", "require", "import"],
    },
    {
      title: "Missing zod/io-ts validation at API boundaries",
      content: "Trusting req.body, req.query, or external API responses as typed data without runtime validation. Parse all external data through Zod schemas at the boundary: `const data = mySchema.parse(req.body)`.",
      domain: "typescript", problemType: "runtime_validation", severity: "high", confidence: 0.92,
      tags: ["zod", "validation", "boundary", "runtime"],
    },
  ];
}
