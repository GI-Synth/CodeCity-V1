# CODECITY_STATUS.md

## CodeCity Intelligence System Audit — March 18, 2026

---

### 1. System Overview
- **Architecture:** Modular agent-based intelligence system with orchestrator (Mayor), specialized agents, reinforcement learning, vector search, and a React-based frontend.
- **Core Technologies:** TypeScript (Node.js), SQLite, Express, React, WebSocket, AI model APIs (Ollama, Groq, OpenRouter, Anthropic, Cerebras).

### 2. Key Components & Files
- **Agent Logic:** artifacts/api-server/src/lib/smartAgents.ts
- **Orchestration:** artifacts/api-server/src/lib/orchestrator.ts
- **Reinforcement Learning:** artifacts/api-server/src/lib/learningReinforcement.ts
- **Finding Quality:** artifacts/api-server/src/lib/findingQuality.ts
- **Agent API:** artifacts/api-server/src/routes/agents.ts
- **Knowledge API:** artifacts/api-server/src/routes/knowledge.ts
- **Frontend City View:** artifacts/software-city/src/pages/CityView.tsx

### 3. Database Schema
- **Tables:** agent_accuracy, agent_messages, agents, city_events, code_graph_edges, code_graph_nodes, execution_results, findings, knowledge, knowledge_fts, knowledge_fts_config, knowledge_fts_data, knowledge_fts_docsize, knowledge_fts_idx, log_entries, metric_snapshots, pattern_suppressions, pattern_weights, reinforcement_events, repos, settings, shared_snapshots

### 4. Environment Variables (AI Providers)
- GROQ_API_KEY, ANTHROPIC_API_KEY, OLLAMA_HOST, MAYOR_OLLAMA_MODEL, OLLAMA_API_KEY, OLLAMA_DEVICE_KEY, OPENROUTER_API_KEY, CEREBRAS_API_KEY, APIFREELLM_API_KEY

### 5. Agent Roles & Specialization
- **Legacy Roles:** qa_inspector, api_fuzzer, load_tester, edge_explorer, ui_navigator, scribe
- **Specialized Roles:** architect, security, performance, quality, documentation, console_log
- **Persona Mapping:** Each role maps to a persona (inspector, guardian, optimizer, architect, scribe, alchemist, quality, documentation, console_log)

### 6. Orchestrator (Mayor)
- **Interval:** 60s think cycle
- **Strategic Modes:** triage, improvement, security, architecture, learning
- **Model Selection:** Prefers Groq, OpenRouter, or Ollama based on env/config
- **City Briefing:** Aggregates city/building/agent/KB stats for each cycle
- **Directive Execution:** Assigns agents, broadcasts bulletins, updates city state

### 7. Knowledge Base
- **Schema:** knowledge table with problemType, language, question, answer, qualityScore, useCount, producedBugs, etc.
- **Vector Search:** Embeddings and cache for fast retrieval
- **Seeding/Training:** scripts/train-kb.ts, scripts/seed-knowledge.ts
- **Reinforcement:** True/false positive verdicts update KB and agent memory

### 8. Reinforcement Learning
- **Personal KB:** Per-agent pattern memory, confidence boosting/decay
- **Shared KB:** Global knowledge reinforcement, pattern weights, suppression
- **Accuracy Tracking:** agent_accuracy table, verdict-driven updates
- **Pattern Suppression:** Prevents repeated false positives

### 9. Finding Quality Pipeline
- **Assessment:** Accepts, observes, or discards findings based on confidence, specificity, and file type
- **Persistence:** Deduplication, event logging, severity escalation
- **Event Types:** bug_found, finding_kept, finding_observation, finding_discarded, verdict, escalation, test_passed, memory_skip

### 10. API Endpoints
- **/agents:** List, spawn, pause, verdict, task, chat, leaderboard, retire, run-tests
- **/knowledge:** Stats, session-stats, entries, search, import, delete, export

### 11. Frontend (CityView)
- **Features:** City map, agent HUD, mayor chat, urgency report, sprint/weekly planning, test generation, export/import, debug HUD
- **Live Metrics:** Health, bugs found, agent status, performance
- **User Controls:** Mayor chat, report/sprint/weekly generation, agent/test management

### 12. Gaps & Issues
- Some DB queries may fail if the database is locked or corrupted (see learningReinforcement.ts error handling)
- Large outputs and file reads require chunked processing for reliability
- Some agent roles/personas are legacy and may not be actively used
- Pattern suppression and reinforcement logic can be bypassed if verdicts are not submitted
- Knowledge base seeding relies on external scripts and may be incomplete if not run

### 13. File Lists (Key Implementation)
- **Agent Logic:** artifacts/api-server/src/lib/smartAgents.ts
- **Orchestrator:** artifacts/api-server/src/lib/orchestrator.ts
- **Reinforcement:** artifacts/api-server/src/lib/learningReinforcement.ts
- **Finding Quality:** artifacts/api-server/src/lib/findingQuality.ts
- **Agent API:** artifacts/api-server/src/routes/agents.ts
- **Knowledge API:** artifacts/api-server/src/routes/knowledge.ts
- **Frontend:** artifacts/software-city/src/pages/CityView.tsx

---

## Detailed Answers to Audit Questions

1. **What agent roles exist?**
   - Legacy: qa_inspector, api_fuzzer, load_tester, edge_explorer, ui_navigator, scribe
   - Specialized: architect, security, performance, quality, documentation, console_log
2. **How are agent personas mapped?**
   - Each role maps to a persona (see smartAgents.ts, mapRoleToPersona)
3. **How does the orchestrator select models?**
   - Prefers Groq, OpenRouter, or Ollama based on env/config (orchestrator.ts)
4. **What is the orchestrator cycle interval?**
   - 60 seconds (orchestrator.ts)
5. **How are city briefings built?**
   - Aggregates repo layout, building stats, agent/KB stats (orchestrator.ts)
6. **How are directives parsed and executed?**
   - JSON or fallback parsing, assigns agents, updates city state (orchestrator.ts)
7. **How is agent accuracy tracked?**
   - agent_accuracy table, verdict-driven updates (learningReinforcement.ts)
8. **How is personal KB updated?**
   - Pattern similarity, confidence boosting/decay, capped at 250 entries (learningReinforcement.ts)
9. **How is shared KB reinforced?**
   - Pattern match, quality score, useCount, producedBugs, cooldowns (learningReinforcement.ts)
10. **How are patterns suppressed?**
    - pattern_suppressions table, 24h default, per-file or global (learningReinforcement.ts)
11. **How are findings classified?**
    - By confidence, specificity, file type (findingQuality.ts)
12. **How are findings persisted?**
    - Deduplication, event logging, severity escalation (findingQuality.ts)
13. **What event types are logged?**
    - bug_found, finding_kept, finding_observation, finding_discarded, verdict, escalation, test_passed, memory_skip (findingQuality.ts, agents.ts)
14. **How is the knowledge base structured?**
    - knowledge table: problemType, language, question, answer, qualityScore, useCount, producedBugs, etc. (knowledge.ts)
15. **How is vector search implemented?**
    - Embeddings, cache, invalidate/search endpoints (knowledge.ts)
16. **How is KB seeding/training performed?**
    - scripts/train-kb.ts, scripts/seed-knowledge.ts
17. **How are verdicts processed?**
    - Updates agent accuracy, personal KB, shared KB, pattern weights, suppression (learningReinforcement.ts, agents.ts)
18. **How are agent tasks assigned?**
    - By orchestrator directive, agent API, or user request (orchestrator.ts, agents.ts)
19. **How are test files generated?**
    - Via Ollama API, fallback to deterministic tests (agents.ts, CityView.tsx)
20. **How are test results recorded?**
    - eventsTable, agent stats updated (agents.ts)
21. **How are escalations handled?**
    - Escalation event, mayor chat, action items (agents.ts, CityView.tsx)
22. **How is agent memory managed?**
    - Per-agent personalKB (JSON), capped, similarity-matched (learningReinforcement.ts)
23. **How is knowledge imported/exported?**
    - /knowledge/import, /knowledge/export endpoints (knowledge.ts)
24. **How is the city view rendered?**
    - React, CityMap, BuildingInspector, HUD, live metrics, agent overlays (CityView.tsx)
25. **How are live metrics displayed?**
    - Health, bugs, agent status, performance (CityView.tsx)
26. **How is the mayor chat implemented?**
    - WebSocket, mayorMessages state, /api/orchestrator/chat (CityView.tsx)
27. **How are urgency reports generated?**
    - /api/orchestrator/report, aggregates findings, stats, recommendations (CityView.tsx)
28. **How are sprints and weekly summaries generated?**
    - /api/orchestrator/sprint, /api/orchestrator/weekly-summary (CityView.tsx)
29. **How are agent leaderboards computed?**
    - /agents/leaderboard, sorted by bugsFound, accuracy, rank (agents.ts)
30. **What are the main gaps or risks?**
    - DB corruption risk, incomplete KB seeding, legacy agent roles, pattern suppression bypass, large output handling, dependency on external AI APIs

---

**End of Audit — Generated March 18, 2026**
