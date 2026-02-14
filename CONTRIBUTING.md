# Contributing to Sorcerer

Thanks for your interest in contributing.

## Development Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

## Quality Gates

Before opening a PR, run:

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm build:all
```

## Pull Request Rules

- Keep PRs focused and reasonably small.
- Include a clear problem statement and solution summary.
- Add or update tests when behavior changes.
- Update docs/README when UX or API behavior changes.

## Commit Guidance

Use clear, imperative commit messages.

Examples:
- `feat(agent): add adaptive budget expansion`
- `fix(ui): handle unbounded iteration display`

## Reporting Bugs

Please use the bug report template and include:
- expected behavior
- actual behavior
- repro steps
- environment details

## Security Reports

Do not open public issues for sensitive vulnerabilities.
Use the process in [`SECURITY.md`](./SECURITY.md).
