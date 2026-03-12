# Phase 4 Handoff — Software City

**Date:** March 12, 2026  
**Status:** All 5 tasks COMPLETE, 0 TypeScript errors

---

## T001 — SQLite Migration ✅ PASS
- Replaced better-sqlite3 with @libsql/client (zero native build)
- All 5 schema files rewritten to SQLite types
- DB auto-creates at `artifacts/api-server/data/city.db`
- `DATABASE_URL` not required; removed from envValidator.ts

## T002 — Landing Redesign + Tour + Shortcuts ✅ PASS
- `Landing.tsx` fully redesigned: hero, animated particles, "How It Works" 3-step accordion (folds/unfolds), recent cities list with health colors, advanced GitHub token panel
- `GuidedTour.tsx` (new): 4-step spotlight overlay, localStorage `sc_tour_done`, spotlight cutout via SVG mask, tooltip with dot-step nav, auto-shows 1.2s after first visit
- `ShortcutsPanel.tsx` (new): keyboard reference modal, triggered by `?` key, grouped by category
- `CityView.tsx`: keyboard shortcuts F3/T/?/Esc/K/A/G/L, `data-tour` attributes on HUD/map/share/sidebar, `onVisibleCountChange` wired to DebugHUD

## T003 — SVG Virtualization ✅ PASS
- `CityMap.tsx` fully rewritten with pan (pointer drag) + zoom (wheel) state
- Zoom formula: `viewBox = center ± (bounds / zoom / 2)`, clamped 0.1×–8×
- Viewport culling: buildings/districts outside viewBox rectangle are skipped
- Roads: culled unless at least one endpoint is visible
- LOD tiers: `zoom < 0.4` → flat rects only; `zoom 0.4–1.5` → full; `zoom > 1.5` → + name labels
- `onVisibleCountChange` callback fires when visible count changes; DebugHUD shows "Rendering X/Y buildings"
- Zoom controls UI (top-left: +, fit, −), zoom % indicator, collapsible minimap

## T004 — Agent Controls ✅ PASS
- **Backend** `agents.ts`:
  - `PATCH /:agentId/pause` — toggles paused ↔ idle
  - `PATCH /pause-all` — pauses/resumes all non-retired agents (registered before `/:agentId/*` routes)
  - `PATCH /:agentId/verdict` — accepts `true_positive | false_positive`, recalculates accuracy = TP / (TP + FP)
- **Frontend** `Agents.tsx`:
  - "Pause All / Resume All" button with live `anyActive` check
  - Per-card "Pause / Resume" button, disabled for retired agents
  - Yellow paused indicator badge on AgentCard
- **Frontend** `BuildingInspector.tsx`:
  - "Focus" target button moves selected agent to this building
  - "Rate Last Finding" section: ThumbsUp (Real Bug) + ThumbsDown (False +) verdict buttons

## T005 — KB Import + Server Search ✅ PASS
- **Backend** `knowledge.ts`:
  - `GET /search?q=...&limit=N` — SQLite LIKE search across question, answer, problemType, language, framework
  - `POST /import` — accepts raw array or `{ entries: [...] }`, validates each entry, inserts valid ones, skips entries missing question/answer, returns `{ imported, skipped, total }`
- **Frontend** `KnowledgeBase.tsx`:
  - "Import JSON" button opens hidden `<input type="file" accept=".json">` 
  - Reads file → parses JSON → POSTs to `/api/knowledge/import` → success toast with count
  - Error toast on bad JSON or server error, file input resets after import

---

## TypeScript Status
```
npx tsc --build lib/db lib/api-zod          → 0 errors
pnpm --filter @workspace/api-server typecheck → 0 errors
pnpm --filter @workspace/software-city typecheck → 0 errors
```

## Notes for Phase 5
- `AgentStatus` in generated types (`lib/api-zod`) does not include `paused` or `retired` — backend returns these values but the OpenAPI spec needs updating. Frontend uses `as string` casts for now.
- The `/api/knowledge/search` endpoint is backend-only (not yet wired to a frontend search toggle, but the client-side filter in KnowledgeBase already covers most use cases)
- Minimap clicking sets zoom to 2× centered on first building of clicked district
