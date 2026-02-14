# Security Policy

## Supported Versions

This is an early project. Security fixes are applied to `main`.

## Reporting a Vulnerability

Please report vulnerabilities privately by emailing:

- **mohamehr@felixin.io**

Include:
- issue summary
- impact assessment
- reproduction steps
- proof-of-concept if available

You will receive an acknowledgment within 72 hours.

## Security Controls

- `main` branch is protected with required status checks and reviews.
- CodeQL and Dependabot run continuously through GitHub Actions.
- Model API URL validation enforces safe protocols and optional host allowlisting (`MODEL_API_ALLOWED_HOSTS`).
- Browser-side API keys are kept in runtime memory and are not persisted to storage.
