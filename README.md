# Sorcerer Autonomous Programming Agent

Sorcerer is a local, workspace-first autonomous coding app built with Next.js.

It provides:
- Multi-workspace local operation
- Bot onboarding (name, API key, model URL/model, workspace)
- Global reusable skills
- Autonomous plan/act/verify runs with live streaming status
- Project intelligence and clarification-first execution
- Run checkpoints/resume + rollback-on-failure controls

## Requirements

- Node.js 20+
- `pnpm`
- Python 3 (only for web search helper)
- Python package `ddgs` for search helper: `pip install ddgs`

## Quick Start

```bash
pnpm install
pnpm dev
```

Open: [http://localhost:7777](http://localhost:7777)

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
- Max iterations
- Team size (1-100)
- Clarification-before-edits gate
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

## Reliability Behavior

- Model calls retry on transient failures (408/429/5xx).
- Request timeout and retry count are configurable by env vars.
- Heartbeat statuses are emitted while waiting for model responses.
- Failed/stale checkpoints are not auto-resumed.
- Invalid model action JSON falls back to a safe discovery action instead of crashing.

## Run Persistence

Run state and checkpoints are stored locally:

- `./.tmp/agent-runs/<runId>/meta.json`
- `./.tmp/agent-runs/<runId>/checkpoint.json`
- `./.tmp/agent-runs/<runId>/events.ndjson`

## API Routes

- `POST /api/agent`
- `POST /api/agent/stream`
- `POST /api/files`
- `POST /api/execute`
- `POST /api/search`
- `POST /api/chat`
- `POST /api/skills`
- `POST /api/workspace/pick`
- `GET /api/intelligence`

## Security Notice

Sorcerer can read/write files and run local commands in selected workspaces. Use only in trusted local environments unless you add authentication, stronger sandboxing, and tighter command controls.
