# FAQ

## Does Sorcerer run fully local?
Sorcerer is local-first for workspace access and orchestration. Model inference depends on your configured model endpoint.

## Can it continue after interruption?
Yes. Sorcerer includes checkpoint + resume and continuation packets to recover from interrupted runs.

## Is autonomous execution safe?
It includes guardrails (workspace path constraints, command/file budgets, verification gates), but you should still review outputs for high-risk changes.

## Where should I ask questions?
Use GitHub Discussions (`Q&A` category):
https://github.com/MohaMehrzad/Sorcerer/discussions

## Where do I report vulnerabilities?
Use the private process in `SECURITY.md`.
