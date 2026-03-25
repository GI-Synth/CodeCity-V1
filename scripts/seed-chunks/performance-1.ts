import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "N+1 query pattern in ORM usage",
      content: "Loading a list then querying related records individually creates N+1 queries. Use eager loading (include/join), batch queries, or DataLoader. Example: fetching 100 users then each user's posts = 101 queries. With include: 1-2 queries total.",
      domain: "performance", problemType: "n_plus_one", severity: "high", confidence: 0.95,
      tags: ["query", "orm", "n+1", "eager-loading"],
    },
    {
      title: "Missing database indexes on foreign keys",
      content: "Foreign key columns without indexes cause full table scans on joins and lookups. Add indexes to all foreign key columns and frequently queried columns. Check query plans with EXPLAIN ANALYZE.",
      domain: "performance", problemType: "missing_index", severity: "high", confidence: 0.92,
      tags: ["index", "database", "foreign-key", "query-plan"],
    },
    {
      title: "Synchronous file I/O in request handlers",
      content: "Using fs.readFileSync or fs.writeFileSync in request handlers blocks the event loop for all concurrent requests. Use async versions: fs.promises.readFile, fs.promises.writeFile, or stream APIs for large files.",
      domain: "performance", problemType: "blocking_io", severity: "high", confidence: 0.95,
      tags: ["sync", "filesystem", "blocking", "async"],
    },
    {
      title: "Blocking event loop with CPU-intensive work",
      content: "Heavy computation (crypto, parsing, image processing) on the main thread blocks all requests. Offload to worker_threads, child_process, or a job queue. Use setImmediate() to yield between steps for long synchronous operations.",
      domain: "performance", problemType: "event_loop_blocking", severity: "high", confidence: 0.92,
      tags: ["event-loop", "worker", "cpu", "blocking"],
    },
    {
      title: "Memory leaks from uncleaned event listeners",
      content: "Adding event listeners in loops or request handlers without removing them causes memory leaks. Call removeEventListener or use AbortController signals. Watch for MaxListenersExceededWarning in Node.js.",
      domain: "performance", problemType: "memory_leak", severity: "high", confidence: 0.90,
      tags: ["memory-leak", "event-listener", "cleanup", "abort"],
    },
    {
      title: "Missing pagination on list endpoints",
      content: "Returning all records from a table without pagination causes memory spikes and slow responses as data grows. Implement cursor-based or offset pagination with a maximum page size (e.g., 100). Always return total count.",
      domain: "performance", problemType: "unbounded_query", severity: "high", confidence: 0.92,
      tags: ["pagination", "limit", "cursor", "offset"],
    },
    {
      title: "Unbounded array growth in loops",
      content: "Pushing to arrays in loops without size limits can exhaust memory. Set maximum sizes, use streaming/chunked processing, or generator functions for large datasets. Monitor array length during iterations.",
      domain: "performance", problemType: "memory_leak", severity: "medium", confidence: 0.85,
      tags: ["array", "memory", "loop", "streaming"],
    },
    {
      title: "Missing caching on expensive computations",
      content: "Recomputing expensive results on every request wastes CPU. Cache with in-memory LRU (lru-cache), Redis, or HTTP cache headers. Set appropriate TTLs based on data freshness requirements. Add cache invalidation on writes.",
      domain: "performance", problemType: "missing_cache", severity: "high", confidence: 0.90,
      tags: ["cache", "lru", "redis", "memoization"],
    },
    {
      title: "Waterfall async operations that could be parallel",
      content: "Awaiting independent async operations sequentially wastes time. Use Promise.all() for independent operations. Example bad: `const a = await getA(); const b = await getB();` Fix: `const [a, b] = await Promise.all([getA(), getB()]);`",
      domain: "performance", problemType: "sequential_async", severity: "medium", confidence: 0.92,
      tags: ["async", "parallel", "promise-all", "waterfall"],
    },
    {
      title: "Large bundle size from unoptimized imports",
      content: "Importing entire libraries when only a few functions are needed bloats bundle size. Use tree-shakeable imports: `import { debounce } from 'lodash-es'` instead of `import _ from 'lodash'`. Analyze with webpack-bundle-analyzer.",
      domain: "performance", problemType: "bundle_size", severity: "medium", confidence: 0.88,
      tags: ["bundle", "tree-shaking", "import", "webpack"],
    },
    {
      title: "Missing React.memo on expensive components",
      content: "Components that receive stable props but re-render with parent can be expensive. Wrap with React.memo() for components rendering lists, charts, or complex DOM. Profile with React DevTools before and after.",
      domain: "performance", problemType: "unnecessary_rerender", severity: "medium", confidence: 0.85,
      tags: ["react", "memo", "rerender", "optimization"],
    },
    {
      title: "useEffect with missing or wrong dependencies",
      content: "Wrong dependency arrays cause effects to run too often (missing dep) or never update (stale closure). Use the eslint react-hooks/exhaustive-deps rule. If an effect fires on every render, check for object/array/function dependencies that recreate each time.",
      domain: "performance", problemType: "effect_dependency", severity: "medium", confidence: 0.90,
      tags: ["useEffect", "dependencies", "stale-closure", "hooks"],
    },
    {
      title: "Unnecessary re-renders from inline objects in JSX",
      content: "Passing `style={{color: 'red'}}` or `options={{a: 1}}` as props creates new objects every render, breaking React.memo. Extract to constants, useMemo, or module-level objects: `const style = { color: 'red' };`.",
      domain: "performance", problemType: "unnecessary_rerender", severity: "medium", confidence: 0.88,
      tags: ["react", "inline-object", "rerender", "useMemo"],
    },
    {
      title: "Missing virtualization for long lists",
      content: "Rendering 1000+ items in a list causes layout thrashing and janky scrolling. Use react-window or react-virtuoso for virtualized lists that only render visible items. Measure before/after with Chrome Performance tab.",
      domain: "performance", problemType: "dom_thrashing", severity: "high", confidence: 0.90,
      tags: ["virtualization", "list", "react-window", "scroll"],
    },
    {
      title: "Unoptimized images and assets",
      content: "Serving uncompressed images wastes bandwidth and slows page load. Use WebP/AVIF formats, responsive sizes (srcset), lazy loading (loading='lazy'), and CDN delivery. Compress images with sharp or imagemin in build pipelines.",
      domain: "performance", problemType: "asset_optimization", severity: "medium", confidence: 0.88,
      tags: ["images", "webp", "lazy-loading", "compression"],
    },
    {
      title: "Missing database connection pooling",
      content: "Opening a new database connection per request creates overhead and exhausts connection limits. Use connection pooling (pg-pool, knex pool, drizzle pool config) with appropriate min/max sizes for your workload.",
      domain: "performance", problemType: "connection_pool", severity: "high", confidence: 0.90,
      tags: ["database", "connection-pool", "postgres", "pool"],
    },
    {
      title: "Excessive console.log in production",
      content: "Console.log serializes objects and writes to stdout, adding latency to every request. Remove or gate debug logging behind environment checks. Use structured loggers (pino, winston) with configurable log levels.",
      domain: "performance", problemType: "excessive_logging", severity: "low", confidence: 0.85,
      tags: ["console", "logging", "production", "pino"],
    },
    {
      title: "Missing HTTP compression (gzip/brotli)",
      content: "Serving uncompressed responses wastes bandwidth, especially for JSON APIs and HTML. Enable gzip/brotli compression middleware: `app.use(compression())`. Configure at reverse proxy level for production.",
      domain: "performance", problemType: "compression", severity: "medium", confidence: 0.88,
      tags: ["gzip", "brotli", "compression", "bandwidth"],
    },
    {
      title: "Unoptimized database queries selecting all columns",
      content: "SELECT * fetches unnecessary columns including large text/blob fields, increasing memory and I/O. Select only needed columns: `db.select({ id, name }).from(users)`. Especially important for tables with JSON or text columns.",
      domain: "performance", problemType: "query_optimization", severity: "medium", confidence: 0.85,
      tags: ["select-star", "columns", "query", "database"],
    },
    {
      title: "String concatenation in hot loops",
      content: "Building strings with += in loops creates O(n²) allocations. Use Array.join() or template literals for building output. For very large strings, use Buffer or streams.",
      domain: "performance", problemType: "string_concat", severity: "medium", confidence: 0.85,
      tags: ["string", "concatenation", "loop", "buffer"],
    },
    {
      title: "Missing debounce on frequent event handlers",
      content: "Handlers for scroll, resize, input, mousemove fire dozens of times per second. Debounce or throttle these handlers: `const handler = debounce(updateSearch, 300)`. Saves CPU and prevents excessive API calls.",
      domain: "performance", problemType: "event_frequency", severity: "medium", confidence: 0.88,
      tags: ["debounce", "throttle", "scroll", "input"],
    },
    {
      title: "Unused polyfills inflating runtime",
      content: "Including polyfills for features already supported by target browsers adds unnecessary code. Configure browserslist correctly and use @babel/preset-env with useBuiltIns: 'usage' to include only needed polyfills.",
      domain: "performance", problemType: "bundle_size", severity: "low", confidence: 0.82,
      tags: ["polyfill", "babel", "browserslist", "bundle"],
    },
    {
      title: "Missing request deduplication",
      content: "Multiple components requesting the same data simultaneously creates redundant API calls. Use SWR, React Query, or a request cache layer that deduplicates in-flight requests by key.",
      domain: "performance", problemType: "duplicate_requests", severity: "medium", confidence: 0.85,
      tags: ["deduplication", "swr", "react-query", "cache"],
    },
    {
      title: "Large JSON payloads without streaming",
      content: "Serializing and parsing multi-MB JSON objects blocks the event loop. Use streaming JSON parsers (JSONStream, oboe.js) for large payloads, or paginate data. Consider Protocol Buffers for high-volume internal APIs.",
      domain: "performance", problemType: "json_parsing", severity: "medium", confidence: 0.82,
      tags: ["json", "streaming", "parsing", "protobuf"],
    },
    {
      title: "Spawning child processes per request",
      content: "Creating child_process.spawn() on every request is expensive. Use worker pools (workerpool, piscina) that reuse processes, or convert shell commands to native Node.js equivalents where possible.",
      domain: "performance", problemType: "process_spawn", severity: "high", confidence: 0.88,
      tags: ["child-process", "worker-pool", "spawn", "piscina"],
    },
  ];
}
