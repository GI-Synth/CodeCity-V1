import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "any type usage instead of proper typing",
      content: "Using `any` disables type checking and allows bugs. Replace with specific types, `unknown` for truly unknown data (with runtime checks), or generics. Use `// eslint-disable-next-line @typescript-eslint/no-explicit-any` only as last resort.",
      domain: "typescript", problemType: "any_type", severity: "medium", confidence: 0.92,
      tags: ["any", "unknown", "type-safety", "strict"],
    },
    {
      title: "Missing return type annotations on public functions",
      content: "Without explicit return types, public API contracts are implicit and can change accidentally. Add return type annotations to all exported functions. Inferred types on internal helpers are fine.",
      domain: "typescript", problemType: "missing_return_type", severity: "medium", confidence: 0.85,
      tags: ["return-type", "annotation", "public-api", "inference"],
    },
    {
      title: "Non-null assertion operator overuse",
      content: "Using `!` (non-null assertion) tells the compiler to trust you, bypassing null checks. Prefer optional chaining (?.), nullish coalescing (??), or proper null guards. Each `!` is a potential runtime crash.",
      domain: "typescript", problemType: "non_null_assertion", severity: "medium", confidence: 0.88,
      tags: ["non-null", "assertion", "optional-chaining", "null-safety"],
    },
    {
      title: "Type assertion instead of type guard",
      content: "`value as SomeType` silences errors without runtime validation. Use type guards: `function isUser(v: unknown): v is User { return typeof v === 'object' && v !== null && 'id' in v; }` for safe narrowing.",
      domain: "typescript", problemType: "type_assertion", severity: "medium", confidence: 0.88,
      tags: ["type-guard", "assertion", "narrowing", "runtime"],
    },
    {
      title: "Missing discriminated union handling",
      content: "Switch statements on discriminated unions without `default: assertNever(x)` let new variants silently pass with no handling. Use exhaustive checks that cause compile errors when variants are added.",
      domain: "typescript", problemType: "exhaustive_check", severity: "medium", confidence: 0.85,
      tags: ["discriminated-union", "exhaustive", "switch", "assertNever"],
    },
    {
      title: "Mutable arrays where readonly would be safer",
      content: "Exposing arrays as mutable allows consumers to accidentally modify shared state. Use `readonly T[]` or `ReadonlyArray<T>` for function parameters and return types of shared data.",
      domain: "typescript", problemType: "mutability", severity: "low", confidence: 0.82,
      tags: ["readonly", "array", "immutable", "parameter"],
    },
    {
      title: "Missing strict null checks handling",
      content: "Code written without strictNullChecks that's later compiled with it generates many errors. Proactively handle null/undefined: use optional chaining, default values, and early returns for null cases.",
      domain: "typescript", problemType: "strict_null", severity: "medium", confidence: 0.88,
      tags: ["strictNullChecks", "null", "undefined", "optional"],
    },
    {
      title: "Enum vs const assertion misuse",
      content: "String enums add runtime code and can't be tree-shaken. Prefer `as const` objects for string unions: `const Status = { Active: 'active', Inactive: 'inactive' } as const; type Status = typeof Status[keyof typeof Status];`",
      domain: "typescript", problemType: "enum_misuse", severity: "low", confidence: 0.82,
      tags: ["enum", "const", "as-const", "union"],
    },
    {
      title: "Generic constraints that are too loose",
      content: "Using `<T>` without constraints allows any type, losing type safety in the generic body. Add constraints: `<T extends Record<string, unknown>>` or `<T extends { id: string }>` to enable safe property access.",
      domain: "typescript", problemType: "loose_generic", severity: "medium", confidence: 0.82,
      tags: ["generic", "constraint", "extends", "type-safety"],
    },
    {
      title: "Missing utility type usage (Partial, Required, Pick, Omit)",
      content: "Duplicating type definitions with optional/required variations instead of using built-in utility types. Use `Partial<User>` for optional fields, `Pick<User, 'id' | 'name'>` for subsets, `Omit<User, 'password'>` for exclusions.",
      domain: "typescript", problemType: "utility_types", severity: "low", confidence: 0.85,
      tags: ["utility-type", "partial", "pick", "omit"],
    },
    {
      title: "Interface vs type alias confusion",
      content: "Using interface for everything including unions and computed types, or type for everything including extendable shapes. Use interface for object shapes that may be extended; use type for unions, intersections, and mapped types.",
      domain: "typescript", problemType: "interface_vs_type", severity: "low", confidence: 0.80,
      tags: ["interface", "type", "alias", "convention"],
    },
    {
      title: "Unsafe property access on optional objects",
      content: "Accessing `obj.prop.nested` without checking if obj or prop exists causes runtime errors. Use optional chaining: `obj?.prop?.nested` and provide defaults: `obj?.prop?.nested ?? fallback`.",
      domain: "typescript", problemType: "optional_access", severity: "medium", confidence: 0.90,
      tags: ["optional-chaining", "null-safety", "nested", "property"],
    },
    {
      title: "Over-specifying function signature types",
      content: "Accepting `string[]` when `readonly string[]` works, or `MyClass` when its interface would suffice makes functions less reusable. Accept the widest type that satisfies the function's needs.",
      domain: "typescript", problemType: "over_specified", severity: "low", confidence: 0.80,
      tags: ["signature", "parameter", "interface", "flexibility"],
    },
    {
      title: "Missing branded types for IDs",
      content: "Using `string` for userId, orderId, productId allows mixing them up without type errors. Create branded types: `type UserId = string & { __brand: 'UserId' }` to prevent cross-type assignment.",
      domain: "typescript", problemType: "branded_types", severity: "medium", confidence: 0.82,
      tags: ["branded", "nominal", "id", "type-safety"],
    },
    {
      title: "Importing types without 'type' keyword",
      content: "Importing types as regular imports includes them in runtime bundles. Use `import type { User } from './types'` to ensure types are erased at compile time and don't affect bundle size.",
      domain: "typescript", problemType: "import_type", severity: "low", confidence: 0.85,
      tags: ["import-type", "bundle", "erasure", "compile"],
    },
    {
      title: "Missing index signature on dynamic objects",
      content: "Accessing dynamic keys on objects without index signatures causes type errors. Use `Record<string, T>`, `Map<string, T>`, or define index signature: `{ [key: string]: T }` for lookups with unknown keys.",
      domain: "typescript", problemType: "index_signature", severity: "low", confidence: 0.82,
      tags: ["index", "record", "map", "dynamic"],
    },
    {
      title: "Improper error typing in catch blocks",
      content: "Catch block errors are `unknown` in strict TypeScript. Check with `if (error instanceof Error)` before accessing `.message` or `.stack`. Never assume catch parameter is `Error` type.",
      domain: "typescript", problemType: "catch_typing", severity: "medium", confidence: 0.88,
      tags: ["catch", "error", "unknown", "instanceof"],
    },
    {
      title: "Using `object` type instead of specific shape",
      content: "`object` type allows any non-primitive but prevents property access. Use specific interfaces, `Record<string, unknown>`, or inline types. `object` is rarely the right choice.",
      domain: "typescript", problemType: "object_type", severity: "low", confidence: 0.82,
      tags: ["object", "specific", "interface", "record"],
    },
    {
      title: "Missing noUncheckedIndexedAccess",
      content: "Array access `arr[0]` returns `T` not `T | undefined` by default. Enable `noUncheckedIndexedAccess` in tsconfig to catch potential undefined access on arrays and records.",
      domain: "typescript", problemType: "unchecked_index", severity: "medium", confidence: 0.82,
      tags: ["noUncheckedIndexedAccess", "array", "undefined", "config"],
    },
    {
      title: "Declaration merging causing confusion",
      content: "Interfaces with the same name auto-merge, which can be exploited but also causes accidental merging from different files. Use unique names or type aliases (which don't merge) to avoid surprises.",
      domain: "typescript", problemType: "declaration_merge", severity: "low", confidence: 0.80,
      tags: ["declaration", "merging", "interface", "naming"],
    },
    {
      title: "Using 'as' to cast fetch/API responses",
      content: "`const data = await res.json() as User` has no runtime validation. Use Zod, io-ts, or manual validation: parse the response, validate shape, then return typed data. Trust no external data.",
      domain: "typescript", problemType: "unsafe_cast", severity: "high", confidence: 0.90,
      tags: ["cast", "fetch", "validation", "zod"],
    },
    {
      title: "Conditional types that are overly complex",
      content: "Nested conditional types `T extends A ? T extends B ? X : Y : Z` are hard to understand and maintain. Extract into named utility types with clear documentation. Limit nesting to 2 levels.",
      domain: "typescript", problemType: "complex_conditional", severity: "low", confidence: 0.80,
      tags: ["conditional", "complexity", "utility-type", "readability"],
    },
    {
      title: "Missing satisfies operator for type validation",
      content: "TypeScript 4.9 `satisfies` validates a value matches a type without widening: `const config = { port: 3000 } satisfies Config`. Preserves literal types while ensuring conformance. Prefer over `as`.",
      domain: "typescript", problemType: "satisfies", severity: "low", confidence: 0.82,
      tags: ["satisfies", "validation", "literal", "config"],
    },
    {
      title: "Void return type on functions that should return",
      content: "Marking a function as `void` return when callers need the result silently loses data. Review async functions — `void` hides promise rejections. Mark as `: Promise<void>` only when truly fire-and-forget.",
      domain: "typescript", problemType: "void_return", severity: "medium", confidence: 0.82,
      tags: ["void", "return", "async", "promise"],
    },
    {
      title: "Massive union types killing IDE performance",
      content: "Union types with 100+ members slow TypeScript language server. Split into categorized sub-unions and compose: `type AllEvents = UIEvent | DataEvent | SystemEvent`. Use branded enums for very large sets.",
      domain: "typescript", problemType: "union_performance", severity: "low", confidence: 0.80,
      tags: ["union", "performance", "language-server", "split"],
    },
  ];
}
