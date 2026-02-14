# Sorcerer

[![Stars](https://img.shields.io/github/stars/MohaMehrzad/Sorcerer?style=for-the-badge)](https://github.com/MohaMehrzad/Sorcerer/stargazers)
[![Forks](https://img.shields.io/github/forks/MohaMehrzad/Sorcerer?style=for-the-badge)](https://github.com/MohaMehrzad/Sorcerer/network/members)
[![License](https://img.shields.io/github/license/MohaMehrzad/Sorcerer?style=for-the-badge)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/MohaMehrzad/Sorcerer/ci.yml?branch=main&style=for-the-badge)](https://github.com/MohaMehrzad/Sorcerer/actions)
[![Latest Release](https://img.shields.io/github/v/release/MohaMehrzad/Sorcerer?style=for-the-badge)](https://github.com/MohaMehrzad/Sorcerer/releases)

**Sorcerer is a local-first autonomous coding agent that plans, edits, verifies, recovers from failures, and keeps moving until acceptance criteria are satisfied.**

If this project helps you, please star it and join discussions:

- Star: [github.com/MohaMehrzad/Sorcerer/stargazers](https://github.com/MohaMehrzad/Sorcerer/stargazers)
- Discuss: [github.com/MohaMehrzad/Sorcerer/discussions](https://github.com/MohaMehrzad/Sorcerer/discussions)

![Sorcerer social preview](./docs/assets/social-preview.png)

## Why Developers Use Sorcerer

- **Actually autonomous:** multi-agent planning, coding, critique, and synthesis loops.
- **Recovery built in:** checkpoint/resume + supervisor retries + adaptive budgets.
- **Safer by default:** write-path safeguards, command allowlists, verification gates.
- **Made for real repos:** local workspace operation, memory, continuation packets, observability.

## 1-Minute Quick Start

```bash
git clone https://github.com/MohaMehrzad/Sorcerer.git
cd Sorcerer
pnpm install
cp .env.example .env.local
# set MODEL_API_KEY in .env.local
pnpm dev
```

- Frontend: [http://localhost:7777](http://localhost:7777)
- Backend: [http://localhost:7778](http://localhost:7778)

## Core Capabilities

- Multi-agent async orchestration (`supervisor`, `scout`, `planner`, `coder`, `critic`, `synthesizer`)
- Single-agent compatibility mode with resume + fallback
- Long-term memory with contradiction detection and evidence gating
- Completion contract checks before accepting "done"
- Adaptive file/command budgets under hard safety ceilings
- Preflight + verification execution with flaky retry/quarantine support
- Telemetry export and run artifacts for auditing

## Requirements

- Node.js 20+
- `pnpm`
- Python 3
- Python package `ddgs` for web search helper: `pip install ddgs`

## Environment

Create `.env.local` from `.env.example`.

Key variables:

- `MODEL_API_KEY` (required unless provided in onboarding)
- `MODEL_API_URL` (optional)
- `MODEL_NAME` (optional)
- `WORKSPACE_DIR` (optional, defaults to repo root)

## Run Modes

Main controls in UI:

- Execution mode: multi-agent async or single-agent legacy
- Max iterations (`0` = unbounded)
- Parallel work units, critic threshold, team size
- Strict verification, auto-fix verification, preflight checks
- Clarification gate, rollback on failure, dry-run
- File-write and command-run budgets

## Project Health + Security

- Local command execution + file mutations are guarded by safety policies.
- Sensitive paths under `.tmp` and secret-like files are blocked from file API writes.
- API supports localhost/origin checks and optional auth token.

Read:

- [`SECURITY.md`](./SECURITY.md)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md).

## Growth

See [`docs/LAUNCH_PLAYBOOK.md`](./docs/LAUNCH_PLAYBOOK.md) for launch strategy and ready-to-post distribution copy.
See [`docs/COMMUNITY_GROWTH_CHECKLIST.md`](./docs/COMMUNITY_GROWTH_CHECKLIST.md) for weekly operating cadence.
See [`docs/GITHUB_PROJECT_SETUP.md`](./docs/GITHUB_PROJECT_SETUP.md) for Projects v2 bootstrap.

## GitHub Surfaces

- Agents: custom agent profiles in [`.github/agents`](./.github/agents)
- Discussions: category forms in [`.github/DISCUSSION_TEMPLATE`](./.github/DISCUSSION_TEMPLATE)
- Actions: CI + security + community workflows in [`.github/workflows`](./.github/workflows)
- Wiki source: [`docs/wiki`](./docs/wiki) (sync via `scripts/sync-wiki.sh`)
- Security: policy in [`SECURITY.md`](./SECURITY.md) and automated checks in Actions

## Support

See [`SUPPORT.md`](./SUPPORT.md).

## License

MIT - see [`LICENSE`](./LICENSE).
