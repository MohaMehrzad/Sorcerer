# Sorcerer Autonomous Programming Agent

Sorcerer is a local, workspace-first autonomous coding app built with Next.js.

It provides:
- Multi-workspace local operation
- Bot onboarding (name, API key, model URL/model, workspace)
- Global reusable skills
- Autonomous plan/act/verify runs with live streaming status
- Async multi-agent orchestration (supervisor, scout, planner, coder, critic, synthesizer)
- Project intelligence and clarification-first execution
- Run checkpoints/resume + rollback-on-failure controls
- Cross-context long-term memory with continuation packets

## Requirements

- Node.js 20+
- `pnpm`
- Python 3 (only for web search helper)
- Python package `ddgs` for search helper: `pip install ddgs`

## Quick Start

```bash
pnpm install
# Terminal 1 (backend API)
pnpm dev:backend

# Terminal 2 (frontend UI)
pnpm dev:frontend
```

Frontend: [http://localhost:7777](http://localhost:7777)  
Backend API: [http://localhost:7778](http://localhost:7778)

`pnpm dev` starts both backend (`7778`) and frontend (`7777`) together.
It now uses an internal supervisor that shuts both processes down cleanly on `Ctrl+C`.

For production-style split runtime:

```bash
pnpm build:all
pnpm start:backend
pnpm start:frontend
```

## Environment Variables

Create `.env.local` in the project root:

```bash
MODEL_API_KEY=<your_model_api_key>

# Optional
# MODEL_API_URL=<your_model_api_url>
# MODEL_NAME=<your_model_name>
# WORKSPACE_DIR=<absolute_path_to_workspace>

# Reliability tuning (optional)
# MODEL_API_MAX_RETRIES=<retry_count>
# MODEL_API_REQUEST_TIMEOUT_MS=<timeout_ms>

# Optional frontend proxy target for /api/*
# BACKEND_API_ORIGIN=http://127.0.0.1:7778
```

Notes:
- `MODEL_API_KEY` is required unless you supply key/url/model in onboarding UI.
- `WORKSPACE_DIR` defaults to the repository root when omitted.

## Workspaces

- Left sidebar lists local workspaces.
- `New Workspace` opens native picker (macOS/Windows) to select folder/file.
- Agent always runs against currently selected workspace path.

## Global Skills

Skills are global to Sorcerer (not per workspace):

- Storage path: `./.sorcerer/skills`
- Create skills from prompt in Bot Setup.
- Enable/disable skill files for autonomous runs.
- Legacy workspace skill files are auto-migrated into global skill storage when listing/creating.

## Autonomous Runs

Start a run from the main panel by entering a goal and pressing `Start Autonomous Run`.

Main controls:
- Execution mode (`multi-agent async` or `single-agent legacy`)
- Max iterations
- Max parallel work units (multi-agent mode)
- Critic pass threshold (multi-agent mode)
- Team size (1-100)
- Clarification-before-edits gate (default: off)
- Preflight checks
- Strict verification and auto-fix loop
- Dry run and rollback on failure
- File-write and command-run budgets

Live run output includes:
- Status updates
- Step log
- Verification checks
- Accessed/edited files
- Recent runs summary
- Per-unit timeline bars (multi-agent mode)
- Exportable telemetry JSON snapshots from current or historical runs
- Memory panel for retrieval, pin/forget, export/import, and latest continuation

## Reliability Behavior

- Model calls retry on transient failures (408/429/5xx).
- Request timeout and retry count are configurable by env vars.
- Heartbeat statuses are emitted while waiting for model responses.
- Failed/stale checkpoints are not auto-resumed.
- Invalid model action JSON falls back to a safe discovery action instead of crashing.
- Multi-agent dependency replanning repairs deadlocks/cycles before declaring blocked.
- Scout/planner artifacts are hash-cached to speed up repeated runs.
- Role-based model routing supports lightweight scout/planner and heavier coder/critic/synthesizer.
- Low-confidence coder outputs and borderline critic scores trigger escalation passes automatically.
- Deterministic `patch_file` hunks use conflict-safe oldText/newText matching before writes.
- Verification supports flaky test retries and quarantine tracking.
- Safety policies deny sensitive write paths (`.git`, `.env*`, key/cert/secret paths).
- Observability includes model usage, retries/cache hits/escalations, unit timings, and failure heatmap.
- Single-agent and multi-agent runs both write continuation packets + long-term memory entries for cross-window resume.
- Memory retrieval now detects contradictory entries and emits diagnostics/guidance.
- When contradictions are active, mutation actions require recent evidence steps before write/delete.

## Long-Term Memory

Local memory store path:

- `./.tmp/agent-memory/memory-store.json`

Stored memory types:

- `bug_pattern`
- `fix_pattern`
- `verification_rule`
- `project_convention`
- `continuation`

Memory metadata:

- Confidence score and success score per entry
- Evidence snapshots (run summary, verification result, command/file evidence)
- Validation state (`lastValidatedAt`, invalidation/supersede relationships)

UI support:

- Retrieve relevant memory context by query
- Pin/unpin memory entries
- Forget memory entries
- Export/import memory store (merge or replace)
- View latest continuation packet to resume after context compaction or reruns
- View conflict count and evidence-gate status on retrieval

## Run Persistence

Run state and checkpoints are stored locally:

- `./.tmp/agent-runs/<runId>/meta.json`
- `./.tmp/agent-runs/<runId>/checkpoint.json`
- `./.tmp/agent-runs/<runId>/events.ndjson`

## API Routes

- `POST /api/agent`
- `POST /api/agent/stream`
- `POST /api/memory`
- `POST /api/files`
- `POST /api/execute`
- `POST /api/search`
- `POST /api/chat`
- `POST /api/skills`
- `POST /api/workspace/pick`
- `GET /api/intelligence`

## Security Notice

Sorcerer can read/write files and run local commands in selected workspaces. Use only in trusted local environments unless you add authentication, stronger sandboxing, and tighter command controls.
