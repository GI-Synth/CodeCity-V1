import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "Missing README for library package",
      content: "Library packages without a README leave consumers guessing about purpose, installation, and API usage. Every publishable package needs: description, install command, basic usage example, and API summary.",
      domain: "documentation", problemType: "missing_readme", severity: "medium", confidence: 0.88,
      tags: ["readme", "library", "package", "onboarding"],
    },
    {
      title: "Outdated API documentation after refactor",
      content: "API docs referencing old endpoint names, removed parameters, or changed response shapes mislead consumers. Treat docs as code: update them in the same PR that changes the API. Add CI checks.",
      domain: "documentation", problemType: "outdated_docs", severity: "medium", confidence: 0.85,
      tags: ["api", "outdated", "refactor", "ci"],
    },
    {
      title: "Comments describing what code does instead of why",
      content: "`// increment counter by 1` is noise. Comments should explain WHY: business rules, non-obvious constraints, workarounds. Self-documenting code + intent-explaining comments is the ideal balance.",
      domain: "documentation", problemType: "comment_what_vs_why", severity: "low", confidence: 0.85,
      tags: ["comment", "why", "intent", "self-documenting"],
    },
    {
      title: "Missing JSDoc on public API functions",
      content: "Public functions without JSDoc comments force consumers to read source code. Add @param descriptions, @returns explanation, @throws for errors, and @example for non-obvious usage patterns.",
      domain: "documentation", problemType: "missing_jsdoc", severity: "medium", confidence: 0.85,
      tags: ["jsdoc", "param", "returns", "example"],
    },
    {
      title: "Missing changelog for versioned releases",
      content: "Users upgrading between versions need a CHANGELOG documenting breaking changes, new features, and fixes. Use conventional commits and auto-generate changelogs with standard-version or changesets.",
      domain: "documentation", problemType: "missing_changelog", severity: "medium", confidence: 0.82,
      tags: ["changelog", "version", "conventional-commits", "release"],
    },
    {
      title: "Missing architecture decision records (ADRs)",
      content: "Important technical decisions undocumented in ADRs get forgotten. When newcomers ask 'why was this done this way?', no one remembers. Record decisions in docs/adr/ with context, options considered, and outcome.",
      domain: "documentation", problemType: "missing_adr", severity: "low", confidence: 0.82,
      tags: ["adr", "architecture", "decision", "context"],
    },
    {
      title: "TODO/FIXME comments without ticket reference",
      content: "TODO comments without a tracking ticket accumulate indefinitely. Add a ticket number: `// TODO(PROJ-123): handle edge case`. Periodically audit TODOs and convert unticketed ones to issues or delete them.",
      domain: "documentation", problemType: "todo_no_ticket", severity: "low", confidence: 0.82,
      tags: ["todo", "fixme", "ticket", "tracking"],
    },
    {
      title: "Missing type documentation for complex generics",
      content: "Complex generic types like `type Merge<A, B> = { [K in keyof A | keyof B]: ... }` without JSDoc are inscrutable. Add examples showing concrete instantiations: `Merge<{a:1}, {b:2}> = {a:1, b:2}`.",
      domain: "documentation", problemType: "generic_docs", severity: "low", confidence: 0.80,
      tags: ["generic", "type", "jsdoc", "example"],
    },
    {
      title: "Setup instructions with missing prerequisites",
      content: "README setup instructions that skip required tools (Node.js version, pnpm, Docker, system libraries) frustrate new developers. List ALL prerequisites with version numbers and install links.",
      domain: "documentation", problemType: "missing_prerequisites", severity: "medium", confidence: 0.85,
      tags: ["setup", "prerequisites", "install", "onboarding"],
    },
    {
      title: "Dead links in documentation",
      content: "Links to moved pages, deleted files, or renamed APIs in docs frustrate users. Use relative links, add link-checking CI (remark-validate-links, markdown-link-check), and update links when renaming.",
      domain: "documentation", problemType: "dead_links", severity: "low", confidence: 0.82,
      tags: ["links", "dead", "broken", "ci"],
    },
    {
      title: "Missing error message documentation",
      content: "Custom error codes or messages without documentation leave users guessing at causes and fixes. Document each error code with: meaning, common causes, and recommended resolution steps.",
      domain: "documentation", problemType: "error_docs", severity: "medium", confidence: 0.82,
      tags: ["error", "code", "message", "resolution"],
    },
    {
      title: "Inline documentation for environment variables",
      content: "Env vars scattered across code without a central list or .env.example are a configuration minefield. Maintain a .env.example with all vars, defaults, descriptions, and required/optional status.",
      domain: "documentation", problemType: "env_documentation", severity: "medium", confidence: 0.85,
      tags: ["env", "example", "configuration", "dotenv"],
    },
    {
      title: "Missing migration guide for breaking changes",
      content: "Major version bumps with breaking changes need a migration guide: what changed, why, and step-by-step instructions to update. Include before/after code examples and codemods when possible.",
      domain: "documentation", problemType: "migration_guide", severity: "medium", confidence: 0.85,
      tags: ["migration", "breaking-change", "guide", "codemod"],
    },
    {
      title: "Stale code comments after logic change",
      content: "Comments that no longer match the code are worse than no comments—they actively mislead. Update or remove comments whenever you modify the code they describe. Code review should check comment accuracy.",
      domain: "documentation", problemType: "stale_comments", severity: "medium", confidence: 0.85,
      tags: ["stale", "comment", "misleading", "maintenance"],
    },
    {
      title: "Missing contributing guide for open source",
      content: "Open source projects without CONTRIBUTING.md lose potential contributors who don't know the process. Document: how to set up dev environment, coding standards, PR process, and issue template.",
      domain: "documentation", problemType: "contributing_guide", severity: "low", confidence: 0.82,
      tags: ["contributing", "open-source", "pr", "standards"],
    },
    {
      title: "Configuration options without documentation",
      content: "Configurable systems without docs for each option force users to read source code. Document every config option: name, type, default, valid values, description, and example in a table or schema.",
      domain: "documentation", problemType: "config_docs", severity: "medium", confidence: 0.85,
      tags: ["config", "options", "defaults", "schema"],
    },
    {
      title: "Missing sequence diagrams for complex flows",
      content: "Complex request flows involving multiple services or async steps are hard to understand from code alone. Add Mermaid sequence diagrams in docs to visualize message flows and timing.",
      domain: "documentation", problemType: "sequence_diagrams", severity: "low", confidence: 0.80,
      tags: ["diagram", "mermaid", "sequence", "flow"],
    },
    {
      title: "Duplicate documentation in multiple locations",
      content: "Same information in README, Wiki, and JSDoc comments goes out of sync. Single-source documentation and link to it from other locations. Prefer inline JSDoc for API docs, README for high-level.",
      domain: "documentation", problemType: "duplicate_docs", severity: "low", confidence: 0.82,
      tags: ["duplicate", "single-source", "sync", "wiki"],
    },
    {
      title: "Missing runbook for production incidents",
      content: "Operations team with no runbook during an incident wastes critical time figuring out procedures. Document common failure modes, diagnostic steps, recovery procedures, and escalation contacts.",
      domain: "documentation", problemType: "missing_runbook", severity: "medium", confidence: 0.82,
      tags: ["runbook", "incident", "operations", "recovery"],
    },
    {
      title: "Code examples that don't compile",
      content: "Documentation examples with syntax errors, missing imports, or deprecated APIs erode trust. Test code examples with tsx or ts-check comments. Use doctest or example-testing tools in CI.",
      domain: "documentation", problemType: "broken_examples", severity: "medium", confidence: 0.85,
      tags: ["example", "compile", "syntax", "testing"],
    },
    {
      title: "Missing deprecation notices",
      content: "Removing APIs without prior deprecation warnings breaks consumers. Add @deprecated JSDoc tags, log deprecation warnings at runtime, and document migration paths before removal.",
      domain: "documentation", problemType: "deprecation_notice", severity: "medium", confidence: 0.85,
      tags: ["deprecation", "jsdoc", "warning", "migration"],
    },
    {
      title: "Inconsistent terminology across documentation",
      content: "Using 'user', 'account', 'member', 'participant' interchangeably for the same concept confuses readers. Define a glossary of domain terms and use them consistently across all documentation.",
      domain: "documentation", problemType: "terminology", severity: "low", confidence: 0.80,
      tags: ["glossary", "terminology", "consistency", "domain"],
    },
    {
      title: "Missing database schema documentation",
      content: "Complex database schemas without ER diagrams or table descriptions force developers to reverse-engineer relationships. Document tables, columns, relationships, constraints, and index strategies.",
      domain: "documentation", problemType: "schema_docs", severity: "medium", confidence: 0.82,
      tags: ["database", "schema", "er-diagram", "columns"],
    },
    {
      title: "Overly verbose documentation burying key info",
      content: "Walls of text where developers need a quick reference. Lead with the most important info: usage example, key parameters. Use tables for options, collapsible sections for details, and TL;DR summaries.",
      domain: "documentation", problemType: "verbose_docs", severity: "low", confidence: 0.80,
      tags: ["verbose", "tldr", "table", "concise"],
    },
    {
      title: "Missing troubleshooting section",
      content: "Common setup issues like 'EACCES permission denied', 'module not found', or 'port already in use' get asked repeatedly. Add a Troubleshooting section to README with FAQ-style problem/solution pairs.",
      domain: "documentation", problemType: "troubleshooting", severity: "low", confidence: 0.82,
      tags: ["troubleshooting", "faq", "setup", "errors"],
    },
  ];
}
