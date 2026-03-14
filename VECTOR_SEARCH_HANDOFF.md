# VECTOR_SEARCH_HANDOFF

Date: 2026-03-14
Workspace: /Users/mvandelac/CodeCity-V1

## 1. Did model download and load?

Yes.

Evidence:
- `[Embeddings] Loading model...`
- `[Embeddings] Model ready`

Observed during embedding smoke test and backfill validation runs.

## 2. How many entries got embedded?

- Startup run: `0` (already embedded)
  - Log: `[Embeddings] All entries already embedded`
- Validation backfill run (probe row inserted intentionally): `1`
  - Logs:
    - `[Embeddings] Embedding 1 entries...`
    - `[Embeddings] 1/1 embedded`
    - `[Embeddings] All entries embedded`

## 3. First vector search result (query, similarity, entry found)

- Query: `what are common async errors`
- Result source: `vector`
- Similarity: `73.7%` (`0.736572...`)
- Entry hit: `what are common async errors`

Evidence:
- `[KB] Hit via vector search (similarity: 73.7%): what are common async errors`
- Escalation response: `"source":"knowledge_base","confidence":0.736572...`

## 4. Did escalation rate change after vector search? (session before/after)

Yes, session hit quality improved after vector-backed retrieval.

Comparison from validation session:
- Before vector-assisted retrieval:
  - `totalEscalations=2`
  - `kbHits=1`
  - `kbMisses=1`
  - `kbHitRate=0.50`
  - `vectorHits=1`
- After vector-assisted retrieval:
  - `totalEscalations=3`
  - `kbHits=2`
  - `kbMisses=1`
  - `kbHitRate=0.6667`
  - `vectorHits=2`

## 5. Did project fingerprinting detect the repo type?

Yes.

Repo load response (`/api/repo/load`) returned:
- `repoName`: `expressjs/express`
- `projectFingerprint.type`: `node-project`
- `language`: `javascript`
- `hasTests`: `true`
- `relevantDomains`: `["general"]`

## 6. TypeScript status

Pass (zero errors).

Command:
- `pnpm run typecheck`

Result:
- All checked workspace projects completed without type errors.

## 7. Model size downloaded (cache check)

Model cache location:
- `node_modules/.pnpm/@xenova+transformers@2.17.2/node_modules/@xenova/transformers/.cache/Xenova/all-MiniLM-L6-v2`

Measured size:
- Directory: `23M`
- Quantized ONNX file: `22M`
  - `onnx/model_quantized.onnx`

## Notes

- Runtime semantic cache verified on startup logs:
  - `[VectorSearch] Building vector cache...`
  - `[VectorSearch] Cache built: 81 vectors`
- `/api/knowledge/session-stats` confirms index presence:
  - `vectorCacheSize: 81`
