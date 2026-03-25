import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "Missing key prop in list rendering",
      content: "React list items without a stable `key` prop cause incorrect reconciliation, stale state, and animation bugs. Use unique business IDs, never array index (unless list is static and never reordered).",
      domain: "react", problemType: "missing_key", severity: "high", confidence: 0.95,
      tags: ["key", "list", "reconciliation", "map"],
    },
    {
      title: "State update on unmounted component",
      content: "Async operations completing after unmount cause 'Can't perform a React state update on an unmounted component'. Use AbortController or a ref flag in useEffect cleanup to cancel pending work.",
      domain: "react", problemType: "unmounted_update", severity: "medium", confidence: 0.88,
      tags: ["unmounted", "state", "useEffect", "cleanup"],
    },
    {
      title: "Missing useEffect dependency array",
      content: "Omitting the dependency array in useEffect causes it to run every render, leading to infinite loops or excessive API calls. Always provide a dep array; use empty array for mount-only effects.",
      domain: "react", problemType: "missing_deps", severity: "high", confidence: 0.92,
      tags: ["useEffect", "dependency", "infinite-loop", "render"],
    },
    {
      title: "Over-rendering from object/array literals in JSX",
      content: "Passing inline `style={{...}}`, `options={[...]}`, or `callback={() => ...}` creates new references every render, defeating React.memo. Extract to constants, useMemo, or useCallback.",
      domain: "react", problemType: "inline_references", severity: "medium", confidence: 0.88,
      tags: ["memo", "useMemo", "useCallback", "render"],
    },
    {
      title: "Prop drilling through many component layers",
      content: "Passing props through 3+ intermediate components that don't use them creates coupling and maintenance burden. Use React Context, composition (children/render props), or a state management library.",
      domain: "react", problemType: "prop_drilling", severity: "medium", confidence: 0.85,
      tags: ["prop-drilling", "context", "composition", "state"],
    },
    {
      title: "Using useEffect for derived state",
      content: "Computing state from props in useEffect causes an extra render cycle. Derive values during render: `const fullName = first + ' ' + last` or use useMemo for expensive computations instead.",
      domain: "react", problemType: "derived_state", severity: "medium", confidence: 0.88,
      tags: ["useEffect", "derived", "useMemo", "render"],
    },
    {
      title: "Stale closure in useEffect or event handlers",
      content: "Callbacks capturing old state values due to closure over stale variables. Add the variable to useEffect deps, use a ref for mutable values accessed in intervals/timeouts, or use functional state updates.",
      domain: "react", problemType: "stale_closure", severity: "high", confidence: 0.90,
      tags: ["closure", "stale", "ref", "useCallback"],
    },
    {
      title: "Direct DOM manipulation in React components",
      content: "Using document.getElementById or direct DOM APIs bypasses React's virtual DOM, causing inconsistencies. Use refs (useRef) for DOM access, and let React manage the DOM through state and props.",
      domain: "react", problemType: "direct_dom", severity: "medium", confidence: 0.88,
      tags: ["dom", "ref", "useRef", "manipulation"],
    },
    {
      title: "Missing error boundary for component trees",
      content: "Unhandled errors in render phase crash the entire app. Wrap major UI sections in error boundaries (class components with componentDidCatch) to isolate failures and show fallback UI.",
      domain: "react", problemType: "error_boundary", severity: "high", confidence: 0.90,
      tags: ["error-boundary", "crash", "fallback", "componentDidCatch"],
    },
    {
      title: "Excessive re-renders from context value changes",
      content: "Wrapping the entire app in a single context that changes frequently re-renders all consumers. Split context by update frequency, memoize the provider value, or use a state management library.",
      domain: "react", problemType: "context_rerender", severity: "medium", confidence: 0.85,
      tags: ["context", "rerender", "split", "provider"],
    },
    {
      title: "Uncontrolled to controlled component switch",
      content: "Starting with `value={undefined}` then setting a value warns about switching from uncontrolled to controlled. Initialize with empty string for text inputs or provide explicit defaultValue.",
      domain: "react", problemType: "controlled_uncontrolled", severity: "low", confidence: 0.88,
      tags: ["controlled", "uncontrolled", "input", "form"],
    },
    {
      title: "Memory leak from uncleared intervals/subscriptions",
      content: "setInterval, WebSocket subscriptions, or event listeners created in useEffect without cleanup leak memory. Always return a cleanup function that clears intervals and removes listeners.",
      domain: "react", problemType: "memory_leak", severity: "high", confidence: 0.92,
      tags: ["interval", "subscription", "cleanup", "leak"],
    },
    {
      title: "Mutating state directly instead of creating new references",
      content: "Pushing to arrays or modifying objects in state directly doesn't trigger re-renders. Always create new references: spread operator `[...arr, item]`, `{...obj, key: val}`, or structuredClone.",
      domain: "react", problemType: "state_mutation", severity: "high", confidence: 0.92,
      tags: ["mutation", "state", "spread", "immutable"],
    },
    {
      title: "Missing Suspense boundary for lazy components",
      content: "React.lazy components need a Suspense boundary with a fallback UI. Without it, the app crashes when the lazy chunk is loading. Wrap lazy routes or heavy components in Suspense.",
      domain: "react", problemType: "suspense_missing", severity: "medium", confidence: 0.88,
      tags: ["suspense", "lazy", "fallback", "code-splitting"],
    },
    {
      title: "Conditional hook calls violating Rules of Hooks",
      content: "Calling hooks inside conditions, loops, or after early returns changes hook call order between renders, causing bugs. Always call hooks at the top level of the component, unconditionally.",
      domain: "react", problemType: "conditional_hooks", severity: "high", confidence: 0.95,
      tags: ["hooks", "rules", "conditional", "order"],
    },
    {
      title: "Large component with multiple responsibilities",
      content: "Components handling data fetching, form logic, validation, and rendering in one file are hard to test and maintain. Extract into custom hooks (data), utility functions (logic), and presentational components.",
      domain: "react", problemType: "large_component", severity: "medium", confidence: 0.85,
      tags: ["responsibility", "hook", "extract", "refactor"],
    },
    {
      title: "Using index as key for dynamic lists",
      content: "Array index as key causes bugs when items are reordered, inserted, or deleted: React reuses the wrong DOM elements. Generate stable unique IDs (crypto.randomUUID, nanoid) when items lack natural IDs.",
      domain: "react", problemType: "index_key", severity: "high", confidence: 0.92,
      tags: ["key", "index", "reorder", "nanoid"],
    },
    {
      title: "Unnecessary forwardRef wrapper",
      content: "In React 19+, ref is a regular prop; forwardRef is no longer needed. For older React, only use forwardRef when the component needs to expose its DOM element or imperative handle to parents.",
      domain: "react", problemType: "forwardRef", severity: "low", confidence: 0.80,
      tags: ["forwardRef", "ref", "wrapper", "react19"],
    },
    {
      title: "Overusing useMemo and useCallback",
      content: "Wrapping every computation in useMemo or every callback in useCallback adds overhead and complexity. Only memoize expensive computations, referentially-sensitive props, or values passed to memoized children.",
      domain: "react", problemType: "over_memoization", severity: "low", confidence: 0.85,
      tags: ["useMemo", "useCallback", "premature", "optimization"],
    },
    {
      title: "Fetching data in component without caching",
      content: "useEffect-based data fetching without caching causes redundant requests on remount, no deduplication, and loading waterfalls. Use TanStack Query, SWR, or a similar cache-first data fetching library.",
      domain: "react", problemType: "data_fetching", severity: "medium", confidence: 0.88,
      tags: ["fetch", "cache", "tanstack", "swr"],
    },
    {
      title: "Missing loading and error states",
      content: "Components that fetch data but only render success state leave users with blank screens during loading or errors. Always handle loading, error, and empty states explicitly.",
      domain: "react", problemType: "loading_error_states", severity: "medium", confidence: 0.88,
      tags: ["loading", "error", "empty", "ux"],
    },
    {
      title: "Event handler defined inside render causing re-allocation",
      content: "Inline arrow functions on onClick etc. are fine for simple cases but cause issues with React.memo children. Move handlers above JSX with useCallback when child components are memoized.",
      domain: "react", problemType: "handler_allocation", severity: "low", confidence: 0.82,
      tags: ["onClick", "handler", "useCallback", "memo"],
    },
    {
      title: "Global CSS leaking into component scope",
      content: "Unscoped CSS class names collide across components. Use CSS Modules, Tailwind, styled-components, or CSS-in-JS to scope styles to components and prevent unintended cascade effects.",
      domain: "react", problemType: "css_scoping", severity: "medium", confidence: 0.85,
      tags: ["css", "modules", "scope", "tailwind"],
    },
    {
      title: "Unnecessary state for computable values",
      content: "Storing values in useState that can be computed from existing state/props wastes memory and requires manual sync. Compute during render or memoize with useMemo instead of creating new state.",
      domain: "react", problemType: "unnecessary_state", severity: "low", confidence: 0.85,
      tags: ["state", "derived", "useMemo", "compute"],
    },
    {
      title: "Missing accessibility attributes on interactive elements",
      content: "Clickable divs without role, aria-label, keyboard handlers, or tabIndex are inaccessible. Use semantic HTML (button, a, input) or add proper ARIA roles and keyboard event handlers.",
      domain: "react", problemType: "accessibility", severity: "medium", confidence: 0.88,
      tags: ["a11y", "aria", "keyboard", "semantic"],
    },
  ];
}
