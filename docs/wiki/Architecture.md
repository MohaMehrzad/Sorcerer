# Architecture

Sorcerer combines UI, API routes, and runtime orchestration inside one Next.js repo.

## Runtime Roles
- `planner`: plans work and sequencing
- `coder`: patches code and files
- `critic`: scores quality and risk
- `supervisor`: enforces completion contracts and retries

## Key Safety Components
- workspace path normalization and root checks
- API access guard for local/authorized access
- command and file budget constraints
- verification gates before completion
