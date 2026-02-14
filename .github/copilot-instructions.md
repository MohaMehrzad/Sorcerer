# Sorcerer Copilot Instructions

## Product Mission
Sorcerer is a local-first autonomous coding agent. Changes should improve one of these outcomes:
- execution reliability
- safety/security guardrails
- developer experience and discoverability

## Architecture
- Frontend + API routes live in `src/app`.
- Autonomous runtime logic lives in `src/lib/server`.
- UI components live in `src/components`.
- Project docs and launch assets live in `docs`.

## Non-Negotiable Guardrails
- Keep filesystem operations constrained to validated workspace roots.
- Do not weaken authentication, CORS, or path validation checks.
- Never persist secrets in browser storage.
- Prefer deterministic, observable behavior over hidden magic.

## Validation Before Merge
Run all of these locally:

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm build:all
```

## PR Expectations
- Keep diffs focused and explain security/perf trade-offs.
- Include verification evidence in PR description.
- Update docs when behavior or setup changes.
