# Sorcerer Launch Playbook

Use this checklist to drive real adoption after publishing the repo.

## Goals (First 14 Days)

- 100+ stars
- 10+ forks
- 5+ external issues/feature requests
- 3+ community contributors

## Launch Sequence

1. **Day 0:** Publish `v0.1.0` release and pin it.
2. **Day 0:** Post a short demo clip/GIF and quick-start thread on X.
3. **Day 1:** Submit to Hacker News (Show HN).
4. **Day 1-2:** Share in Reddit communities relevant to self-hosted/devtools/AI coding.
5. **Day 3:** Publish a technical deep-dive article (Dev.to/Hashnode/Medium).
6. **Day 5:** Ship small follow-up update (`v0.1.1`) with user-requested improvement.
7. **Day 7+:** Post weekly changelog thread and highlight contributor PRs.

## Distribution Channels

- X / Twitter
- Hacker News (Show HN)
- Reddit (`r/selfhosted`, `r/opensource`, `r/LocalLLaMA`, `r/programming` if rules allow)
- Dev.to / Hashnode
- Discord/Slack engineering communities

## Message Angle

Lead with outcomes, not internals.

Good:
- "Autonomous coding agent that actually recovers and verifies before claiming done."

Weak:
- "A Next.js app with multi-agent architecture."

## Content Cadence

- 2-3 product updates per week
- 1 technical deep dive per week
- 1 contributor spotlight per week

## Launch Copy Templates

### X Post

```text
Built something I wanted for my own workflow:

Sorcerer: a local-first autonomous coding agent that plans, edits, verifies, and recovers until acceptance criteria are met.

- Multi-agent orchestration
- Checkpoint + resume
- Long-term memory
- Completion contract before "done"

Repo + quick start: https://github.com/MohaMehrzad/Sorcerer
```

### Show HN

```text
Show HN: Sorcerer — local-first autonomous coding agent with recovery loops

I built Sorcerer to solve a pain point: most coding agents stop too early or fail without recovery.

Sorcerer runs locally on your workspace and includes:
- multi-agent orchestration
- checkpoint/resume
- adaptive recovery loops
- completion contract checks before accepting completion

Looking for brutally honest feedback from developers using real repositories.

GitHub: https://github.com/MohaMehrzad/Sorcerer
```

### Reddit

```text
I built an open-source local coding agent that can recover from failures and continue automatically.

Main idea: avoid one-shot runs. Sorcerer uses checkpoints, supervisor retries, and verification gates so it keeps moving until criteria are satisfied.

Would love feedback from people using it on actual projects.

Repo: https://github.com/MohaMehrzad/Sorcerer
```

## Conversion Checklist

Before every promotional post:

- README hero and quick start are above the fold
- Latest release is visible
- Open issues labeled clearly (`good first issue`, `help wanted`)
- CI badge green
- Demo image/GIF available
- Setup works in under 3 minutes
