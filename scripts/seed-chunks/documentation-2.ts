import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "Missing OpenAPI/Swagger specification",
      content: "REST APIs without machine-readable specs disable auto-generated clients, testing, and documentation. Use OpenAPI 3.x to describe endpoints, schemas, auth, and examples. Generate from code or code from spec.",
      domain: "documentation", problemType: "openapi_spec", severity: "medium", confidence: 0.85,
      tags: ["openapi", "swagger", "spec", "codegen"],
    },
    {
      title: "Missing license file in repository",
      content: "Repos without a LICENSE file have default copyright protection, meaning others legally cannot use the code. Add a license file (MIT, Apache 2.0, etc.) that matches your intended usage terms.",
      domain: "documentation", problemType: "missing_license", severity: "medium", confidence: 0.82,
      tags: ["license", "mit", "copyright", "open-source"],
    },
    {
      title: "Git commit messages without context",
      content: "Commits like 'fix bug' or 'update' provide no context for future debugging. Use conventional commits: 'fix(auth): prevent token refresh race condition'. Include the why, not just the what.",
      domain: "documentation", problemType: "commit_messages", severity: "low", confidence: 0.82,
      tags: ["git", "commit", "conventional", "context"],
    },
    {
      title: "Missing pull request template",
      content: "PRs without structured descriptions slow down review. Add a .github/pull_request_template.md with sections for: changes summary, testing done, breaking changes, and linked issues.",
      domain: "documentation", problemType: "pr_template", severity: "low", confidence: 0.80,
      tags: ["pr", "template", "review", "github"],
    },
    {
      title: "Missing security policy for vulnerability reports",
      content: "Without SECURITY.md, security researchers don't know how to responsibly disclose vulnerabilities. Document: how to report, expected response time, disclosure policy, and supported versions.",
      domain: "documentation", problemType: "security_policy", severity: "medium", confidence: 0.82,
      tags: ["security", "vulnerability", "disclosure", "policy"],
    },
    {
      title: "Missing rate limit documentation for API consumers",
      content: "APIs with undocumented rate limits surprise consumers with 429 errors. Document: rate limit values, headers (X-RateLimit-*), reset behavior, and how to request higher limits for legitimate use.",
      domain: "documentation", problemType: "rate_limit_docs", severity: "medium", confidence: 0.82,
      tags: ["rate-limit", "429", "headers", "api"],
    },
    {
      title: "Missing CI/CD pipeline documentation",
      content: "CI/CD pipelines opaque to developers slow down debugging build failures. Document: pipeline stages, required secrets, deployment process, how to run CI locally, and rollback procedures.",
      domain: "documentation", problemType: "cicd_docs", severity: "low", confidence: 0.80,
      tags: ["ci", "cd", "pipeline", "deployment"],
    },
    {
      title: "Undocumented feature flags",
      content: "Feature flags without documentation are a maintenance nightmare: unknown state, forgotten cleanup, and mysterious behavior differences. Track each flag: purpose, owner, expected removal date, and default.",
      domain: "documentation", problemType: "feature_flags", severity: "medium", confidence: 0.82,
      tags: ["feature-flag", "toggle", "tracking", "cleanup"],
    },
    {
      title: "README code examples in wrong language version",
      content: "README showing ES5 syntax for an ES2022+ project or vice versa confuses users. Match examples to the project's target environment and tsconfig. Use TypeScript examples for TS projects.",
      domain: "documentation", problemType: "example_version", severity: "low", confidence: 0.80,
      tags: ["example", "version", "syntax", "typescript"],
    },
    {
      title: "Missing WebSocket event documentation",
      content: "WebSocket APIs with undocumented event types, message formats, and connection protocols are unusable. Document: connection URL, auth flow, event names, message schemas, and reconnection behavior.",
      domain: "documentation", problemType: "ws_docs", severity: "medium", confidence: 0.85,
      tags: ["websocket", "event", "message", "protocol"],
    },
    {
      title: "Missing code ownership documentation",
      content: "Without CODEOWNERS or ownership docs, PRs sit unreviewed and questions go unanswered. Add CODEOWNERS file mapping directories to responsible teams/individuals for automatic review assignment.",
      domain: "documentation", problemType: "code_owners", severity: "low", confidence: 0.80,
      tags: ["codeowners", "review", "ownership", "team"],
    },
    {
      title: "Undocumented database migration procedures",
      content: "Database migrations without documented procedures risk data loss. Document: how to create migrations, run them, rollback, test with production data safely, and handle schema conflicts.",
      domain: "documentation", problemType: "migration_procedures", severity: "medium", confidence: 0.82,
      tags: ["migration", "database", "rollback", "procedure"],
    },
    {
      title: "Missing accessibility documentation for UI components",
      content: "Component libraries without a11y docs produce inaccessible applications. Document: keyboard interactions, ARIA attributes, screen reader behavior, and focus management for each component.",
      domain: "documentation", problemType: "a11y_docs", severity: "medium", confidence: 0.82,
      tags: ["accessibility", "a11y", "aria", "keyboard"],
    },
    {
      title: "Missing monitoring and alerting documentation",
      content: "Metrics without context are meaningless. Document: what each metric measures, normal ranges, alerting thresholds, escalation procedures, and dashboards for each service.",
      domain: "documentation", problemType: "monitoring_docs", severity: "low", confidence: 0.80,
      tags: ["monitoring", "alerting", "metrics", "dashboard"],
    },
    {
      title: "Non-standard project structure without documentation",
      content: "Unconventional project layouts slow onboarding. If deviating from framework conventions, document the structure: what each directory contains, build artifacts location, and module boundaries.",
      domain: "documentation", problemType: "project_structure", severity: "low", confidence: 0.82,
      tags: ["structure", "directory", "conventions", "onboarding"],
    },
    {
      title: "Missing data flow documentation",
      content: "Complex data pipelines (ETL, event flows, state machines) are hard to reason about from code alone. Document data flow with diagrams showing sources, transformations, destinations, and error paths.",
      domain: "documentation", problemType: "data_flow_docs", severity: "low", confidence: 0.80,
      tags: ["data-flow", "pipeline", "diagram", "etl"],
    },
    {
      title: "Missing browser/platform support documentation",
      content: "Frontend packages without documented browser support matrix cause compatibility bugs. Declare supported browsers, required polyfills, and known limitations for each target platform.",
      domain: "documentation", problemType: "browser_support", severity: "low", confidence: 0.80,
      tags: ["browser", "support", "polyfill", "compatibility"],
    },
    {
      title: "Missing API error response documentation",
      content: "Only documenting success responses leaves consumers guessing about error formats. Document all error response codes, body shapes, and error code meanings for each endpoint.",
      domain: "documentation", problemType: "error_response_docs", severity: "medium", confidence: 0.85,
      tags: ["error", "response", "api", "status-code"],
    },
    {
      title: "Missing performance benchmarks documentation",
      content: "Performance-sensitive code without benchmark results or methodology makes optimization decisions guesswork. Document: benchmarking tools, methodology, baseline numbers, and regression thresholds.",
      domain: "documentation", problemType: "benchmark_docs", severity: "low", confidence: 0.80,
      tags: ["benchmark", "performance", "methodology", "baseline"],
    },
    {
      title: "Unlinked related documentation pages",
      content: "Documentation pages that don't cross-reference related topics force users to search. Add 'See also' links, breadcrumbs, and navigation between related concepts for discoverable docs.",
      domain: "documentation", problemType: "cross_references", severity: "low", confidence: 0.80,
      tags: ["cross-reference", "links", "navigation", "related"],
    },
  ];
}
