# CodeCity Intelligence Master Plan
*Version 2.0 — Full Rewrite*

---

## Vision

CodeCity becomes a self-improving AI engineering team that lives inside your codebase. Agents are not pattern matchers — they are specialized engineers with persistent memory, shared communication, and the ability to understand, analyze, fix, and improve your software autonomously. The Mayor is the senior architect: 50x smarter, cross-referencing all agent findings, making strategic decisions, and closing the loop back into the codebase.

---

## What This Plan Adds Beyond V1

| V1 | V2 |
|---|---|
| 5 KB rows, pattern matching | 500+ seeded KB, semantic code graph |
| Reinforcement never fires | Reinforcement fires on every verdict |
| Agents work in isolation | Agents chat, collaborate, escalate to peers |
| Mayor gives generic advice | Mayor gives specific, actionable fixes with diffs |
| No console log awareness | Agents read and interpret runtime console logs |
| No self-improvement loop | Accepted recommendations update KB and agent weights |
| Tests = bug findings only | Tests = full arsenal: static, security, perf, coverage, deps |

---

## Architecture: Three-Layer Knowledge System

### Layer 1 — Live Semantic Code Graph
Built on every import and re-analysis. Never stale.

- Nodes: every file, function, class, exported symbol
- Edges: imports, calls, extends, implements, re-exports
- Metadata per node: complexity score, test coverage %, LOC, last modified, circular dep flag, dead code flag
- Stored in SQLite as a queryable graph
- Agents query this graph instead of reading raw files
- Powers statements like: "This function is called by 14 modules. Changing it is high risk. Complexity score 87/100. Zero test coverage. Highest priority."

### Layer 2 — Pattern Knowledge Base
Minimum 500 quality entries on first seed. Covers:

- Language-specific anti-patterns (TypeScript, JavaScript, Python, etc.)
- Security vulnerabilities (OWASP Top 10, injection, XSS, auth issues)
- Performance anti-patterns (N+1 queries, memory leaks, blocking I/O)
- Architecture smells (god objects, circular deps, feature envy, shotgun surgery)
- Framework-specific issues (React hooks rules, Express middleware order, etc.)
- SOLID violations with concrete examples
- Common refactoring opportunities

### Layer 3 — Project Memory
Per-project, per-agent learning. Persists across sessions.

- Every Mayor-accepted recommendation → pattern weight +1
- Every Mayor-rejected recommendation → pattern weight -1
- Agents track their own accuracy rate per domain
- High-accuracy agents get higher finding weight in Mayor synthesis
- Agents remember what they were wrong about and stop repeating it

---

## Agent System: Specialized Roles

### Agent Types (each with distinct focus)

**Architect Agent**
- Reads the full dependency graph
- Finds circular dependencies, tight coupling, god modules
- Recommends structural refactors
- Tracks architecture health score over time

**Security Agent**
- Runs security-focused analysis on every file
- Checks for: hardcoded secrets, injection vectors, unsafe deserialization, auth bypasses, exposed endpoints
- Cross-references findings with CVE patterns in KB
- Never repeats the same finding for the same file within 24h

**Performance Agent**
- Identifies: N+1 patterns, synchronous blocking, memory leaks, large bundle contributors, unindexed queries
- Reads runtime console logs to correlate with code locations
- Reports slow paths with stack trace context

**Quality Agent**
- Tracks test coverage gaps by file
- Identifies untested high-complexity functions
- Generates test skeletons as recommendations
- Monitors code duplication above threshold

**Documentation Agent**
- Finds undocumented public APIs
- Detects stale comments that no longer match code
- Recommends JSDoc/TSDoc additions for complex functions

**Console Log Agent** *(new)*
- Continuously reads and parses runtime console output
- Classifies logs: error, warning, performance, info
- Maps log entries back to source file + line number
- Reports runtime errors to Mayor with full context
- Correlates repeated errors with code graph to find root cause

### Agent Communication Layer *(new)*

All agents share a real-time message bus. Every agent can:
- Broadcast findings to all other agents
- Direct-message a specific agent for peer review
- Request help: "Security Agent: I found an auth bypass in auth.ts — Performance Agent, can you check if this path is also a bottleneck?"
- Escalate to Mayor with full peer-reviewed context
- Vote on findings: other agents can upvote/downvote a finding before it reaches the Mayor

**Agent Chat is visible in CodeCity UI:**
- Dedicated "Agent Chat" panel in the interface
- Real-time message stream with agent names, colors, timestamps
- Filterable by agent, by type (finding, question, escalation, vote)
- Mayor messages appear in a distinct style
- Users can read the full conversation and interject via Mayor Chat

---

## The Mayor: 50x Smarter

### Mayor Intelligence Upgrade

The Mayor is not a chatbot. The Mayor is a senior engineering architect with access to:

1. **Full code graph** — knows every file, every dependency, every complexity hotspot
2. **All agent findings** — synthesized, deduplicated, cross-referenced
3. **Project history** — what was fixed, what was accepted, what was rejected
4. **Runtime logs** — what is actually failing in production right now
5. **Health trend** — is the codebase getting better or worse over time
6. **Agent accuracy scores** — weights findings by which agents have been right before

### Mayor Decision Framework

For every recommendation the Mayor produces:

```
FINDING: [specific description with file + line]
SEVERITY: critical | high | medium | low
CONFIDENCE: [0-100] based on agent votes + KB match + graph evidence
EVIDENCE: [list of supporting signals from multiple agents]
SPECIFIC FIX: [actual code diff or refactoring steps]
RISK: [what could break if we fix this]
ESTIMATED EFFORT: [hours]
IMPACT: [what improves: performance, security, maintainability, test coverage]
```

No more generic "improve test coverage." Every recommendation is specific, actionable, and includes a proposed fix.

### Mayor Strategic Modes

**Triage Mode** — Mayor focuses on: what is broken RIGHT NOW based on console logs and error rates. Emergency fixes only.

**Improvement Mode** — Mayor focuses on: highest-complexity, lowest-coverage files. Systematic quality improvement.

**Security Mode** — Mayor focuses on: all security agent findings, sorted by severity. Produces security audit report.

**Architecture Mode** — Mayor focuses on: structural issues, circular deps, coupling. Produces refactoring roadmap.

**Learning Mode** — Mayor reviews all pending verdicts, applies reinforcement, updates agent weights, grows KB.

---

## Test Arsenal: Everything That Makes Code Better

Beyond bug finding, agents run these analysis types:

### Static Analysis
- TypeScript strict mode violations
- ESLint rule violations with auto-fix suggestions
- Unused imports, variables, exports
- Type safety gaps (any usage, missing return types)
- Unreachable code detection

### Complexity Analysis
- Cyclomatic complexity per function
- Cognitive complexity scoring
- Function length violations
- File size violations
- Nesting depth violations

### Dependency Analysis
- Circular dependency detection with full cycle paths
- Unused dependency detection (package.json vs actual imports)
- Outdated dependency flagging
- Bundle size contribution per dependency
- Duplicate dependency detection

### Security Analysis
- Hardcoded credentials / secrets scan
- SQL injection pattern detection
- XSS vulnerability patterns
- Unsafe eval() usage
- Exposed sensitive routes
- Missing input validation
- Insecure random number generation

### Test Coverage Analysis
- Coverage % per file from existing test runs
- Uncovered function identification
- Test skeleton generation for uncovered functions
- Test quality analysis (assertions per test, test description quality)

### Performance Analysis
- Async/await anti-patterns
- Memory leak patterns (event listeners not cleaned up, closures holding references)
- Database query patterns (N+1, missing indexes in ORM usage)
- Bundle size analysis
- Render performance issues (React-specific)

### Runtime Analysis (Console Log Agent)
- Error rate per source file
- Warning frequency analysis
- Performance timing log parsing
- Stack trace to source mapping
- Correlation between log errors and code complexity hotspots

### Documentation Analysis
- Public API documentation coverage
- README freshness (last updated vs last code change)
- Inline comment quality
- Stale TODO detection with age

### Architecture Analysis
- Feature envy detection (functions that use other modules more than their own)
- God object detection
- Interface segregation violations
- Dependency inversion violations
- Module cohesion scoring

---

## Self-Improvement Loop

### How CodeCity Learns

1. Agent finds issue → submits to peer review (other agents vote)
2. High-confidence finding → escalated to Mayor
3. Mayor produces specific recommendation with diff
4. User accepts/rejects via Mayor Chat
5. **If accepted:**
   - Pattern weight +1 in KB
   - Agent accuracy score improves
   - Similar patterns get higher priority in future scans
   - KB entry created/updated with this specific example
6. **If rejected:**
   - Pattern weight -1
   - Agent notes rejection reason
   - Similar findings suppressed for this project
   - KB entry flagged as false positive for this codebase type

### KB Seeding Strategy

On first run, seed with:
- 100 TypeScript/JavaScript anti-pattern entries
- 50 React-specific patterns
- 50 Node.js/Express patterns
- 50 security vulnerability patterns
- 50 performance anti-patterns
- 50 architecture smell patterns
- 50 test quality patterns
- 100 general software engineering patterns

Total: 500+ entries before agents even start learning.

---

## Console Log Integration

### Console Log Agent Workflow

1. Agent subscribes to runtime log stream (stderr/stdout from dev server)
2. Every log entry is classified and parsed
3. Stack traces are resolved to source file + line
4. Errors are correlated with the code graph
5. Repeated errors (same location > 3 times) are escalated to Mayor
6. Performance timing logs are analyzed for slow paths
7. Full log context is included in agent chat and Mayor briefings

### Log Classification
- `[ERROR]` → immediate escalation with source mapping
- `[WARN]` → batched and reported every 10 minutes
- `[PERF]` → performance agent picks up and correlates
- `[INFO]` → Console Log Agent archives for pattern detection

---

## Agent Chat UI

### What Users See

A dedicated panel in CodeCity showing:

```
[10:24:31] 🔵 Security Agent: Found potential SQL injection in /api/users.ts:47
[10:24:32] 🟢 Quality Agent: That file also has 0% test coverage. Supporting escalation.
[10:24:33] 🟡 Performance Agent: Confirmed — that endpoint is also the slowest in the app (avg 2.3s)
[10:24:34] 🔴 Architect Agent: /api/users.ts is imported by 23 files. High blast radius.
[10:24:35] ⚪ Console Log Agent: Runtime logs show 47 errors from this file in the last hour.
[10:24:36] 👑 Mayor: CRITICAL — /api/users.ts requires immediate attention. 5 agents flagged it. Producing fix recommendation now.
```

### Chat Features
- Filter by agent
- Filter by severity
- Filter by time window
- Click any finding to jump to the relevant file in CodeCity map
- Mayor Chat is bidirectional — user can respond and redirect Mayor focus
- Agent chat is archived and searchable

---

## Implementation Phases

### Phase 0: Foundation (Week 1)
- Build semantic code graph schema and ingestion pipeline
- Seed KB with 500+ entries
- Wire reinforcement loop (make it actually fire)
- Add agent message bus infrastructure

### Phase 1: Agent Specialization (Week 2)
- Implement all 6 specialized agent types with distinct prompts
- Wire each agent to the code graph
- Add peer review / voting system
- Add Console Log Agent with log stream subscription

### Phase 2: Mayor Intelligence (Week 3)
- Upgrade Mayor prompt with full context injection (graph + logs + agent scores + history)
- Implement all 5 Mayor strategic modes
- Add specific fix generation (diffs, not generic advice)
- Add confidence scoring with evidence attribution

### Phase 3: Agent Chat UI (Week 3-4)
- Build real-time agent chat panel in CodeCity
- Add message bus to UI via websocket
- Add filtering and search
- Add click-to-navigate from chat to city map

### Phase 4: Self-Improvement Loop (Week 4)
- Wire accept/reject verdicts to KB updates
- Implement agent accuracy scoring
- Add finding weight by agent track record
- Add project memory persistence

### Phase 5: Full Test Arsenal (Week 5)
- Wire in all static analysis tools
- Add runtime log analysis pipeline
- Add architecture analysis suite
- Add documentation coverage analysis

### Phase 6: Verification (Week 6)
- All hard gates pass
- KB has 500+ real entries
- Reinforcement fires on every verdict
- Agent chat visible and useful
- Mayor recommendations include specific diffs
- Console log errors mapped to source files

---

## Hard Gates for Done

- [ ] KB entries >= 500 with domain diversity
- [ ] Reinforcement coverage >= 0.60 over 24h
- [ ] Reinforcement attempts >= 10 over 24h
- [ ] Distinct finding types >= 10 per 24h run
- [ ] Agent chat visible in UI with real-time messages
- [ ] Console log errors mapped to source file + line
- [ ] Mayor recommendations include specific file + line + proposed fix
- [ ] Self-improvement loop: accepted recommendation updates KB within 60s
- [ ] Agent accuracy scores visible in UI
- [ ] All 6 specialized agent types running with distinct findings
- [ ] Zero repeated identical findings from same agent within 24h
- [ ] Mayor strategic modes selectable from UI
