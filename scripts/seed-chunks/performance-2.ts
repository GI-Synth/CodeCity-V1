import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "Missing CDN for static assets",
      content: "Serving static files from the application server adds latency and load. Use a CDN (CloudFront, Cloudflare) for JS/CSS/images with far-future cache headers. Configure cache-busting via content hashes in filenames.",
      domain: "performance", problemType: "cdn", severity: "medium", confidence: 0.85,
      tags: ["cdn", "static", "cache", "cloudfront"],
    },
    {
      title: "Premature optimization of non-bottleneck code",
      content: "Optimizing code that isn't a measured bottleneck wastes time and adds complexity. Profile first with --inspect, Chrome DevTools, or autocannon/k6 before optimizing. Focus on the top 1-3 hotspots.",
      domain: "performance", problemType: "premature_optimization", severity: "low", confidence: 0.82,
      tags: ["profiling", "bottleneck", "measure", "devtools"],
    },
    {
      title: "Synchronous crypto operations blocking event loop",
      content: "crypto.pbkdf2Sync, crypto.scryptSync block the event loop during hashing. Use async versions: crypto.pbkdf2(), crypto.scrypt(), or bcrypt.hash() which are async by default.",
      domain: "performance", problemType: "blocking_crypto", severity: "high", confidence: 0.90,
      tags: ["crypto", "sync", "pbkdf2", "blocking"],
    },
    {
      title: "Missing lazy loading for below-fold content",
      content: "Loading all page content eagerly delays initial render. Use lazy loading for images (loading='lazy'), route-based code splitting (React.lazy), and intersection observer for infinite scroll sections.",
      domain: "performance", problemType: "lazy_loading", severity: "medium", confidence: 0.85,
      tags: ["lazy", "loading", "code-splitting", "intersection"],
    },
    {
      title: "Heavy middleware on every request",
      content: "Running expensive middleware (auth, logging, parsing) on every route including health checks wastes resources. Apply middleware selectively: rate limiting only on public routes, parsing only when needed.",
      domain: "performance", problemType: "middleware_overhead", severity: "medium", confidence: 0.82,
      tags: ["middleware", "selective", "routing", "overhead"],
    },
    {
      title: "DNS lookup overhead on every external call",
      content: "Node.js resolves DNS on every HTTP request by default. Use keep-alive connections (http.Agent with keepAlive: true) and DNS caching to reduce latency on repeated calls to the same host.",
      domain: "performance", problemType: "dns_overhead", severity: "medium", confidence: 0.82,
      tags: ["dns", "keep-alive", "agent", "connection"],
    },
    {
      title: "Rendering full page on small state changes",
      content: "Server-side rendering the entire page for minor updates wastes CPU. Use partial hydration, island architecture, or client-side state updates for interactive elements. Reserve SSR for initial page load.",
      domain: "performance", problemType: "ssr_overhead", severity: "medium", confidence: 0.80,
      tags: ["ssr", "hydration", "partial", "rendering"],
    },
    {
      title: "Missing HTTP/2 multiplexing",
      content: "HTTP/1.1 limits parallel requests per connection. Enable HTTP/2 on your server/CDN to multiplex requests over a single connection, reducing latency for pages with many assets.",
      domain: "performance", problemType: "http2", severity: "low", confidence: 0.80,
      tags: ["http2", "multiplexing", "protocol", "latency"],
    },
    {
      title: "Inefficient regex on large inputs",
      content: "Complex regex patterns on large strings can be exponentially slow. Use string methods (indexOf, includes, split) for simple searches. For complex parsing, use dedicated parsers or streaming approaches.",
      domain: "performance", problemType: "regex_performance", severity: "medium", confidence: 0.85,
      tags: ["regex", "string", "parsing", "performance"],
    },
    {
      title: "Missing preconnect/prefetch hints",
      content: "Browsers delay DNS/TLS for external resources until discovery. Add `<link rel='preconnect' href='https://api.example.com'>` for known external origins. Use prefetch for likely-next-page resources.",
      domain: "performance", problemType: "resource_hints", severity: "low", confidence: 0.82,
      tags: ["preconnect", "prefetch", "dns-prefetch", "hints"],
    },
    {
      title: "Unindexed full-text search queries",
      content: "LIKE '%search%' queries scan entire tables. Use FTS (Full-Text Search) extensions in SQLite/PostgreSQL, or dedicated search engines (Elasticsearch, Typesense) for text search at scale.",
      domain: "performance", problemType: "full_text_search", severity: "high", confidence: 0.88,
      tags: ["fts", "search", "like", "elasticsearch"],
    },
    {
      title: "Global state subscriptions causing cascade rerenders",
      content: "Subscribing entire component trees to global state (Redux, Context) causes unnecessary rerenders. Use selectors to subscribe only to needed slices: `useSelector(s => s.user.name)` instead of `useSelector(s => s)`.",
      domain: "performance", problemType: "state_subscription", severity: "medium", confidence: 0.88,
      tags: ["redux", "context", "selector", "rerender"],
    },
    {
      title: "Missing query result caching in ORM",
      content: "Identical queries executed multiple times per request waste database resources. Use query-level caching with TTL, or data loaders that batch and cache within a single request lifecycle.",
      domain: "performance", problemType: "query_cache", severity: "medium", confidence: 0.85,
      tags: ["cache", "query", "orm", "dataloader"],
    },
    {
      title: "Large DOM tree causing layout thrashing",
      content: "DOM trees with 1500+ nodes slow down style calculations, layout, and paint. Reduce DOM size by virtualizing hidden content, using CSS for decorative elements, and removing wrapper divs.",
      domain: "performance", problemType: "dom_size", severity: "medium", confidence: 0.82,
      tags: ["dom", "layout", "nodes", "virtualization"],
    },
    {
      title: "Missing service worker caching strategy",
      content: "Without service worker caching, every visit requires full network requests. Implement stale-while-revalidate for API calls and cache-first for static assets using Workbox for a clean API.",
      domain: "performance", problemType: "service_worker", severity: "medium", confidence: 0.80,
      tags: ["service-worker", "workbox", "cache", "offline"],
    },
    {
      title: "Uncompressed WebSocket messages",
      content: "Large JSON payloads over WebSocket waste bandwidth. Enable per-message deflate compression in ws library: `new WebSocketServer({ perMessageDeflate: true })`. Use binary formats for high-frequency updates.",
      domain: "performance", problemType: "websocket_compression", severity: "low", confidence: 0.80,
      tags: ["websocket", "compression", "deflate", "binary"],
    },
    {
      title: "Expensive operations in React render path",
      content: "Sorting, filtering, or transforming large arrays directly in the render function re-executes on every render. Use useMemo: `const sorted = useMemo(() => items.sort(...), [items]);` to cache derived data.",
      domain: "performance", problemType: "render_computation", severity: "medium", confidence: 0.90,
      tags: ["useMemo", "render", "sort", "derived-data"],
    },
    {
      title: "Missing batch processing for bulk operations",
      content: "Inserting/updating records one by one is orders of magnitude slower than batching. Use bulk insert APIs: `INSERT INTO ... VALUES (...), (...), (...)` or ORM batch methods. Process in chunks of 100-500.",
      domain: "performance", problemType: "batch_processing", severity: "high", confidence: 0.90,
      tags: ["batch", "bulk", "insert", "chunking"],
    },
    {
      title: "Excessive API polling instead of push",
      content: "Polling APIs every few seconds wastes bandwidth and CPU. Use WebSockets, Server-Sent Events (SSE), or long polling for real-time updates. Fall back to polling only when push mechanisms aren't available.",
      domain: "performance", problemType: "polling", severity: "medium", confidence: 0.85,
      tags: ["polling", "websocket", "sse", "real-time"],
    },
    {
      title: "Large dependency tree increasing cold start time",
      content: "Importing many modules at startup delays first request. Use dynamic import() for rarely-used modules, audit dependency tree size, and consider alternatives for heavy packages (e.g., date-fns over moment).",
      domain: "performance", problemType: "cold_start", severity: "medium", confidence: 0.82,
      tags: ["cold-start", "import", "dependency", "dynamic"],
    },
    {
      title: "Missing ETag/conditional request support",
      content: "Without ETags, clients re-download unchanged resources. Implement ETag generation (content hash) and handle If-None-Match to return 304 Not Modified. Express static middleware supports this by default.",
      domain: "performance", problemType: "conditional_request", severity: "low", confidence: 0.82,
      tags: ["etag", "304", "conditional", "caching"],
    },
    {
      title: "Unmemoized callback props causing child rerenders",
      content: "Passing inline functions as props to memoized children defeats React.memo. Wrap with useCallback: `const onClick = useCallback(() => { ... }, [dep])` to maintain reference stability.",
      domain: "performance", problemType: "callback_memoization", severity: "medium", confidence: 0.88,
      tags: ["useCallback", "memo", "reference", "rerender"],
    },
    {
      title: "Missing database query timeout",
      content: "Queries without timeouts can hang indefinitely, exhausting connection pool. Set statement_timeout in PostgreSQL, busy_timeout in SQLite, or use Promise.race with a timeout for all database operations.",
      domain: "performance", problemType: "query_timeout", severity: "high", confidence: 0.85,
      tags: ["timeout", "database", "connection", "hang"],
    },
    {
      title: "Over-fetching data from API endpoints",
      content: "Returning all fields when clients need only a few wastes bandwidth and processing. Implement field selection (sparse fieldsets), GraphQL, or dedicated view-model endpoints that return only needed data.",
      domain: "performance", problemType: "over_fetching", severity: "medium", confidence: 0.82,
      tags: ["over-fetching", "fields", "graphql", "api"],
    },
    {
      title: "Blocking main thread with JSON.stringify on large objects",
      content: "JSON.stringify on large objects (>1MB) blocks the event loop for hundreds of milliseconds. Use streaming JSON serialization, offload to a worker thread, or paginate the data to keep payloads small.",
      domain: "performance", problemType: "json_stringify", severity: "medium", confidence: 0.85,
      tags: ["json", "stringify", "blocking", "worker"],
    },
  ];
}
