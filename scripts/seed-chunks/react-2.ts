import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "useReducer for complex state logic",
      content: "When state updates depend on multiple fields or have complex transitions, useState becomes unwieldy. useReducer with a typed action union gives predictable state transitions and is easier to test.",
      domain: "react", problemType: "state_management", severity: "low", confidence: 0.82,
      tags: ["useReducer", "state", "complex", "action"],
    },
    {
      title: "Portal usage for modals and tooltips",
      content: "Rendering modals inside nested components causes z-index battles and overflow clipping. Use createPortal to render modals at document.body level while keeping React tree context and event bubbling.",
      domain: "react", problemType: "portal", severity: "medium", confidence: 0.85,
      tags: ["portal", "modal", "z-index", "overflow"],
    },
    {
      title: "Missing React.StrictMode in development",
      content: "StrictMode double-invokes effects, renders, and reducers in dev to catch impure code. Missing it hides bugs that surface in production. Wrap the root in StrictMode during development.",
      domain: "react", problemType: "strict_mode", severity: "low", confidence: 0.82,
      tags: ["strictMode", "development", "double-render", "purity"],
    },
    {
      title: "Sync external store without useSyncExternalStore",
      content: "Reading from external stores (browser APIs, third-party state) in render without useSyncExternalStore can cause tearing in concurrent mode. Use the hook for correct concurrent-safe subscriptions.",
      domain: "react", problemType: "external_store", severity: "medium", confidence: 0.82,
      tags: ["useSyncExternalStore", "concurrent", "tearing", "subscription"],
    },
    {
      title: "Unmemoized context provider value",
      content: "Passing an object literal as context value: `<Ctx.Provider value={{a, b}}>` creates a new object every render, re-rendering all consumers. Memoize with useMemo: `useMemo(() => ({a, b}), [a, b])`.",
      domain: "react", problemType: "context_value", severity: "medium", confidence: 0.88,
      tags: ["context", "useMemo", "provider", "rerender"],
    },
    {
      title: "Fetching inside useEffect on every render",
      content: "Without proper dependency tracking, data fetching in useEffect runs on every render. Use a data key in the dep array or a caching library. Add AbortController in cleanup to cancel stale requests.",
      domain: "react", problemType: "fetch_every_render", severity: "medium", confidence: 0.85,
      tags: ["fetch", "useEffect", "deps", "abort"],
    },
    {
      title: "Missing displayName on forwardRef components",
      content: "Components wrapped in forwardRef show as 'ForwardRef' in DevTools, making debugging hard. Set displayName: `MyComponent.displayName = 'MyComponent'` or use named function expressions.",
      domain: "react", problemType: "displayName", severity: "low", confidence: 0.80,
      tags: ["displayName", "devtools", "forwardRef", "debug"],
    },
    {
      title: "Non-serializable values in state",
      content: "Storing class instances, Dates, Maps, or functions in React state can break time-travel debugging, server components, and serialization. Prefer plain objects and arrays; convert on read.",
      domain: "react", problemType: "serializable_state", severity: "low", confidence: 0.80,
      tags: ["state", "serializable", "plain", "class"],
    },
    {
      title: "Layout thrashing from sequential DOM reads and writes",
      content: "Reading DOM measurements (offsetHeight) then modifying DOM causes layout thrashing. Batch reads together, then batch writes. Use useLayoutEffect for measurements that affect visual layout.",
      domain: "react", problemType: "layout_thrashing", severity: "medium", confidence: 0.85,
      tags: ["layout", "thrashing", "useLayoutEffect", "measurement"],
    },
    {
      title: "Server component data leaking to client bundle",
      content: "In Next.js App Router, importing server-only modules or sensitive data in client components bundles them to the browser. Use 'server-only' package guards and keep sensitive logic in server components.",
      domain: "react", problemType: "server_client_leak", severity: "high", confidence: 0.88,
      tags: ["server-component", "client", "bundle", "nextjs"],
    },
    {
      title: "Race condition in sequential state updates",
      content: "Calling setState multiple times with values depending on current state can use stale values. Use the updater form: `setState(prev => prev + 1)` to ensure each update sees the latest state.",
      domain: "react", problemType: "state_race", severity: "medium", confidence: 0.88,
      tags: ["setState", "updater", "race", "stale"],
    },
    {
      title: "Excessive component nesting for layout purposes",
      content: "Deeply nesting wrapper divs for styling creates complex DOM trees. Use CSS Grid or Flexbox with fewer containers, fragment syntax (<>), or composition patterns to flatten component hierarchy.",
      domain: "react", problemType: "nesting_depth", severity: "low", confidence: 0.80,
      tags: ["nesting", "wrapper", "flexbox", "fragment"],
    },
    {
      title: "Rendering large lists without virtualization",
      content: "Rendering 1000+ items in a list causes slow initial render and high memory use. Use react-window or @tanstack/virtual to virtualize long lists, rendering only visible items.",
      domain: "react", problemType: "virtualization", severity: "high", confidence: 0.90,
      tags: ["virtualization", "react-window", "performance", "list"],
    },
    {
      title: "Missing debounce on search input state updates",
      content: "Updating search state on every keystroke triggers expensive re-renders or API calls. Debounce the handler with useDeferredValue, debounce utility, or store an uncontrolled input ref.",
      domain: "react", problemType: "debounce", severity: "medium", confidence: 0.85,
      tags: ["debounce", "search", "useDeferredValue", "input"],
    },
    {
      title: "React Three Fiber mesh without dispose cleanup",
      content: "Three.js geometries, materials, and textures are not garbage collected automatically. In R3F, use useEffect cleanup or drei's useDisposable to dispose GPU resources when components unmount.",
      domain: "react", problemType: "r3f_dispose", severity: "medium", confidence: 0.85,
      tags: ["r3f", "three.js", "dispose", "gpu"],
    },
    {
      title: "Missing Suspense for data in React 18+ transitions",
      content: "React 18 transitions and use() hook require Suspense boundaries to show loading UI while data resolves. Without Suspense, the entire tree blocks on the data, showing nothing.",
      domain: "react", problemType: "suspense_data", severity: "medium", confidence: 0.82,
      tags: ["suspense", "transition", "use", "loading"],
    },
    {
      title: "Unoptimized images in React apps",
      content: "Large uncompressed images hurt load times. Use next/image for Next.js, or lazy loading with loading='lazy', srcSet for responsive sizes, and modern formats (WebP, AVIF) for all images.",
      domain: "react", problemType: "image_optimization", severity: "medium", confidence: 0.85,
      tags: ["image", "lazy", "srcset", "webp"],
    },
    {
      title: "Using dangerouslySetInnerHTML without sanitization",
      content: "dangerouslySetInnerHTML with unsanitized user content allows XSS attacks. Always sanitize with DOMPurify or a similar library before injecting HTML. Consider markdown rendering as a safer alternative.",
      domain: "react", problemType: "xss_innerhtml", severity: "critical", confidence: 0.95,
      tags: ["xss", "dangerouslySetInnerHTML", "sanitize", "dompurify"],
    },
    {
      title: "Hydration mismatch between server and client",
      content: "Server-rendered HTML differing from client render causes hydration errors. Avoid Date.now(), Math.random(), or browser-only APIs in initial render. Use suppressHydrationWarning only for intentional differences.",
      domain: "react", problemType: "hydration", severity: "medium", confidence: 0.85,
      tags: ["hydration", "ssr", "mismatch", "server"],
    },
    {
      title: "Missing key reset pattern for component reinitialization",
      content: "To reset a component's state when a prop changes, avoid useEffect; instead change the key prop: `<Form key={userId} />`. React unmounts and remounts on key change, giving fresh state.",
      domain: "react", problemType: "key_reset", severity: "low", confidence: 0.85,
      tags: ["key", "reset", "state", "reinitialize"],
    },
    {
      title: "Shared mutable ref across renders without syncing",
      content: "useRef holds a mutable value that doesn't trigger re-renders. Reading ref.current during render can show stale values. Only read refs in effects and event handlers, not during render output.",
      domain: "react", problemType: "ref_render", severity: "medium", confidence: 0.85,
      tags: ["useRef", "mutable", "render", "stale"],
    },
    {
      title: "Component not splitting code per route",
      content: "Importing all route components eagerly in the router bundles everything upfront. Use React.lazy with dynamic import for route-level code splitting: `const Page = lazy(() => import('./Page'))`.",
      domain: "react", problemType: "code_splitting", severity: "medium", confidence: 0.88,
      tags: ["lazy", "code-splitting", "route", "bundle"],
    },
    {
      title: "Form state management without library",
      content: "Hand-rolled form state with individual useState per field is verbose and error-prone. Use react-hook-form or Formik for complex forms with validation, submission, error handling, and field arrays.",
      domain: "react", problemType: "form_library", severity: "low", confidence: 0.82,
      tags: ["form", "react-hook-form", "validation", "state"],
    },
    {
      title: "Testing implementation details instead of behavior",
      content: "Tests checking internal state, lifecycle methods, or component instances break on refactors. Test user-visible behavior using React Testing Library: render, interact, assert visible output.",
      domain: "react", problemType: "testing_behavior", severity: "medium", confidence: 0.85,
      tags: ["testing", "behavior", "rtl", "refactor"],
    },
    {
      title: "Missing tree-shaking with named vs default exports",
      content: "Default exports prevent tree-shaking in some bundlers because the entire module is imported. Prefer named exports for utility modules so bundlers can eliminate unused code from the bundle.",
      domain: "react", problemType: "tree_shaking", severity: "low", confidence: 0.80,
      tags: ["tree-shaking", "named-export", "bundle", "default"],
    },
  ];
}
