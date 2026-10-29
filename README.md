# YouTube Knowledge Engine

A dual-memory knowledge engine built from **Starter Story** YouTube transcripts. Scrapes founder-interview transcripts, stores them in a vector database (ChromaDB) for semantic search AND a knowledge graph (Neo4j) for structured multi-hop queries, then answers founder questions with evidence-grounded advice, patterns, and generated playbooks.

> Production-RAG patterns in a repo small enough to read end to end: vector + graph
> dual memory, hybrid retrieval, verified citations, and eval-driven quality
> measurement. Built as a learning project and kept honest about it.

## Why this exists

Most RAG demos answer confidently and cite nothing. That is fine in a demo and
disqualifying in production, because a plausible invented citation is worse than no
answer — the reader cannot tell the difference.

I learned that the expensive way. As a founding engineer at SigIQ I built an AI tutor
that reached 200,000 students preparing for UPSC, an exam where a wrong fact costs
somebody a year. A model that invents a source there does not produce a bad user
experience; it produces a student who learned something false and has no way to know.
What we ended up with was a rule that sounds austere until you have watched the
alternative: **no model output reaches a user unless it can point at the source it came
from.**

This repo is that rule, built small enough to read. The interesting part is not the
retrieval — it is the layer that refuses to trust the model:

- **Evidence is verified, not assumed.** `src/lib/extraction/evidence-validator.ts`
  takes every citation the model produced and checks it actually exists in the vector
  store. Citations that do not resolve get dropped rather than rendered. The model
  proposes; a deterministic check disposes.
- **Every external boundary is Zod-validated** — transcripts, LLM output, API input.
  Structured extraction that does not parse is a failure, not a warning.
- **Quality is measured, not asserted.** `bun run eval` scores embedding triplet
  accuracy, retrieval Recall@k / MRR / nDCG / latency, and graph entity
  recall/precision against a golden set, so a change that makes retrieval worse shows
  up as a number instead of a vibe.
- **Two memories, deliberately.** A vector store answers "what is similar to this";
  a graph answers "which founders who did X later did Y". Most questions worth asking
  need the second kind, and pure vector RAG cannot do multi-hop.

It is built over Starter Story founder interviews because that corpus is public and
the questions are real, but the channel is a parameter, not the point. Swap the feed
and it is a brain for any channel.

## Architecture

```
YouTube channel (RSS, no API key)
      │
      ▼
Transcript extraction (youtube-transcript, no API key)
      │
      ▼
Chunking (1000 chars, 200 overlap, timestamps preserved)
      │
      ├──────────────► Local embeddings (MiniLM-L6-v2, 384-dim)
      │                        │
      │                        ▼
      │                ChromaDB  ◄──── semantic memory
      │
      └──────────────► LLM entity extraction (gpt-4o-mini, Zod-validated)
                               │
                               ▼
                       Neo4j graph  ◄──── structured memory
                       Founder → Startup → Strategy/Tool → Outcome/Workflow
                               │
                               ▼
                       Pattern layer (Redis-cached graph aggregates)

Retrieval (POST /api/knowledge/ask):
  question → context extraction → patterns (cached)
           + multi-hop graph examples
           + semantic search
           → gpt-4o synthesis → grounded answer with sources
```

### Components

| Layer | Tech | Notes |
|---|---|---|
| Runtime | Bun | Fast TS execution, built-in test runner |
| API | Hono | Lightweight, middleware-friendly |
| Transcripts | `youtube-transcript` + RSS | Zero API keys |
| Embeddings | `@xenova/transformers` (MiniLM-L6-v2) | Local, free; Jina API optional |
| Vector DB | ChromaDB | Cosine similarity, 384-dim |
| Graph DB | Neo4j + APOC | Multi-hop Cypher queries |
| Cache/queue | Redis | Pattern cache + async job queue |
| Extraction/synthesis | Groq (llama-3.3-70b), Gemini (gemini-2.5-flash), xAI Grok (grok-4-fast), or OpenAI (gpt-4o) | One OpenAI-compatible SDK, provider via env, Zod-validated output |
| Validation | Zod | All external data + LLM output |

## Quick Start

```bash
# 1. Start infrastructure (ChromaDB + Neo4j + Redis)
docker-compose up -d chromadb neo4j redis

# 2. Configure
cp .env.example .env   # add GROQ_API_KEY / GEMINI_API_KEY / XAI_API_KEY / OPENAI_API_KEY for synthesis

# 3. Install and run
bun install
bun run dev
```

Scrape a channel:

```bash
curl -X POST http://localhost:3100/api/youtube/scrape-channel \
  -H "Content-Type: application/json" \
  -d '{"channelUrl": "https://www.youtube.com/@starterstory", "maxVideos": 30}'
```

Backfill the graph from existing ChromaDB data (needs an LLM key):

```bash
bun run scripts/backfill-graph.ts
```

## API

### Knowledge (the brain)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/knowledge/ask` | POST | **Main advisor.** Free-text question → context extraction → patterns + graph examples + semantic search → synthesized, evidence-grounded answer |
| `/api/knowledge/patterns` | GET | Precomputed patterns for a context (`?founderType=solo&stage=MVP&refresh=true`) |
| `/api/knowledge/generate-playbook` | POST | Structured playbook (modules/lessons/action items) with evidence validation against ChromaDB |
| `/api/knowledge/stats` | GET | Live node counts (graph) + chunk count (vector) |

```bash
curl -X POST http://localhost:3100/api/knowledge/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "How do solo technical founders get their first customers for a SaaS?"}'
```

Response shape: `{ answer, context, patterns, examples, sources, synthesized }` — every example is a real founder from the graph, every source a transcript excerpt with timestamp. Without an LLM key, returns raw retrieval (patterns + examples + sources) with `synthesized: false`.

### Query Explorer (visualize retrieval)

Open **http://localhost:3100/explorer** — a built-in UI that runs `/api/knowledge/ask` and visualizes the full pipeline per query:

- Stage cards with live status: context extraction (LLM vs heuristic), pattern layer (Redis cache HIT/miss), graph multi-hop, vector search, synthesis
- Stage timing bars (where the milliseconds go)
- Strategy usage/success-rate bars, tool frequency chips
- Founder example cards from the graph with outcomes and video links
- Semantic sources with cosine-similarity bars and timestamps
- Raw response JSON toggle

Every `/ask` response also includes a `trace` object (`stages[]` with `ms`, `status`, `detail`) so you can instrument programmatically.

For raw graph exploration, Neo4j Browser runs at **http://localhost:7474** (`neo4j`/`password`). Useful queries:

```cypher
// The whole schema
CALL db.schema.visualization()

// What did a specific startup do?
MATCH (f:Founder)-[:FOUNDED]->(s:Startup)-[r]->(x)
WHERE s.name CONTAINS 'name here'
RETURN f, s, x LIMIT 50

// Top strategies among solo founders
MATCH (f:Founder {type:'solo'})-[:FOUNDED]->(:Startup)-[r:IMPLEMENTED_STRATEGY]->(st:Strategy)
RETURN st.name, count(r) AS uses ORDER BY uses DESC LIMIT 10
```

### YouTube ingestion

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/youtube/scrape-video` | POST | Scrape single video |
| `/api/youtube/scrape-channel` | POST | Scrape channel (async job via Redis queue) |
| `/api/youtube/search` | POST | Raw semantic search |
| `/api/youtube/chat` | POST | RAG context for external LLM use |
| `/api/youtube/stats` | GET | Collection stats |

### Eval

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/eval/run` | POST | Run full eval suite |
| `/api/eval/latest` | GET | Latest report (`?format=markdown`) |
| `/api/eval/history` | GET | Score history |

CLI: `bun run eval` — measures embedding triplet accuracy, retrieval Recall@k/MRR/nDCG/latency, graph entity recall/precision. See [eval/README.md](eval/README.md).

## Channel Terminal (multi-channel chat UI)

One server serves every channel in [`channels.json`](channels.json). Open
**http://localhost:3100/app**, pick a channel, and ask it anything:

- answers cite numbered, timestamped transcript excerpts; citations jump to the source list
- suggested questions rotate (curated per domain + drawn from real video titles)
- recent searches per browser (anonymous `x-client-id`, Redis-backed, 90-day TTL)
- follow-ups keep context; `/help` lists terminal commands

Add a channel: ingest it into its own collection + tracker (see below), then add an
entry to `channels.json` with a `domain` from `src/domains/`.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/channels` | GET | Channels with video + chunk counts |
| `/api/channels/:id/suggestions` | GET | Rotating starter questions |
| `/api/channels/:id/recent` | GET / DELETE | This browser's recent questions (`x-client-id`) |
| `/api/channels/:id/ask` | POST | `{ question, history? }` → cited answer |

## Second corpus: InterNACHI home inspection

The same engine serves the [InterNACHI](https://www.youtube.com/@internachi) channel
(~3,600 videos, ~1,400 hours) as a separate, vector-only knowledge base. A **domain
profile** (`src/domains/`, selected by `KNOWLEDGE_DOMAIN`) switches the synthesis voice
and turns off the founder graph, which does not apply to inspection content. Corpora
stay isolated: own Chroma collection, own tracker file, own Redis queue prefix.

```bash
# list the channel once (the in-app scraper can't paginate 3k+ videos without an API key)
yt-dlp --flat-playlist --print "%(id)s|%(title)s|%(duration)s" \
  "https://www.youtube.com/@internachi/videos" > data/youtube/internachi-videos.txt

bun run ingest:internachi        # resumable, throttled, backs off on YouTube rate limits
bun run start:internachi         # API + explorer on http://localhost:3101/explorer
```

`/api/knowledge/ask` answers with numbered `[n]` citations to timestamped transcript
excerpts and says so when the excerpts don't cover the question. Only ChromaDB (and
Redis) are needed for this domain; Neo4j is skipped.

## Security

- **Auth**: set `API_KEY` in env → all `/api/*` routes require `x-api-key` header (constant-time comparison). Unset = open (local dev).
- **Rate limiting**: fixed-window per IP, Redis-backed with in-memory fallback. Tune via `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX`.
- No secrets in code — everything from env vars (see [.env.example](.env.example)).

## How Retrieval Works (GraphRAG)

1. **Context extraction** — the extraction model (gemini-2.5-flash / grok-4-fast / gpt-4o-mini) pulls structured context from the question (`founderType`, `stage`, `startupType`, `budget`, `goal`). Keyword heuristics as fallback when no API key.
2. **Pattern layer** — graph aggregates (top strategies with success rates, top tools, workflows, avg outcomes) per context, cached in Redis for 6h. Cache invalidated automatically after new extractions.
3. **Multi-hop graph query** — `Founder → Startup → Strategy/Tool → Outcome → Video` chains for founders matching the context.
4. **Semantic search** — ChromaDB for supporting quotes with timestamps.
5. **Synthesis** — the synthesis model (gemini-2.5-flash / grok-4-fast / gpt-4o) answers with the retrieved evidence only; system prompt forbids ungrounded claims.
6. **Evidence validation** (playbooks) — every cited quote is checked against ChromaDB; hallucinated evidence flagged `[UNVERIFIED]`.

Full design doc: [docs/GRAPHRAG_IMPLEMENTATION.md](docs/GRAPHRAG_IMPLEMENTATION.md).

## Project Structure

```
src/
├── index.ts                  # Hono server, middleware, workers
├── config.ts                 # All env config
├── middleware/security.ts    # API key auth + rate limiting
├── lib/
│   ├── youtube*.ts           # Transcript fetching, chunking, tracking
│   ├── youtube-vectorstore.ts# ChromaDB + local embeddings
│   ├── extraction/           # LLM entity extraction → Neo4j
│   │   ├── extractor.ts      # gpt-4o-mini extraction (writes graph)
│   │   ├── graph-store.ts    # Neo4j schema + atomic writes
│   │   ├── synthesizer.ts    # Multi-hop graph + vector synthesis
│   │   ├── guide-generator.ts# Playbook generation
│   │   └── evidence-validator.ts # Anti-hallucination check
│   ├── patterns/pattern-layer.ts # Redis-cached graph aggregates
│   ├── retrieval/
│   │   ├── context-extractor.ts  # Question → structured context
│   │   └── advisor.ts            # /ask pipeline
│   ├── queue/                # Redis job queue + worker
│   └── schemas/              # Zod schemas (entities, context, playbook)
├── routes/                   # youtube, knowledge, eval
└── eval/                     # Eval framework (metrics, runners)

scripts/
├── scrape-starter-story.ts   # Bulk channel scrape
├── backfill-graph.ts         # ChromaDB → Neo4j extraction backfill
└── run-eval.ts               # Eval CLI

dashboard/                    # React + Vite + Tailwind UI
docs/                         # Design docs (archive/ = historical)
```

## Current Dataset

- 221 Starter Story videos scraped
- 3,128 transcript chunks in ChromaDB
- Graph populated via `scripts/backfill-graph.ts` (one-time, ~$25-40 in gpt-4o-mini calls)

## Cost Model

| Item | Cost |
|---|---|
| Transcripts + embeddings | $0 (local, no API keys) |
| One-time graph extraction (221 videos) | ~$25-40 (gpt-4o-mini) |
| Per `/ask` query | ~$0.01-0.03 (context extraction + synthesis) |
| Patterns endpoint | $0 after first hit (Redis cache) |
| Infra | $0 self-hosted (Docker) |

## Development

```bash
bun run dev          # hot-reload server
bun test             # tests
bunx tsc --noEmit    # typecheck
bun run eval         # quality eval suite
```

## Open core

This repository is the engine, and it is genuinely usable on its own — self-host it,
point it at a channel, query it, and never talk to me.

| Open, MIT, here | Closed |
|---|---|
| Ingestion, chunking, embeddings | Multi-tenancy |
| Vector + graph storage and retrieval | Hosted infrastructure |
| Evidence validation and guardrails | Embeddable widget |
| Eval suite and golden set | Dashboard and billing |
| HTTP API and CLI, single-tenant | |

The boundary is stated here so it is not a surprise later: everything needed to run
this yourself stays open. What gets sold, if anything gets sold, is not having to.

## License

MIT — see [LICENSE](./LICENSE).
