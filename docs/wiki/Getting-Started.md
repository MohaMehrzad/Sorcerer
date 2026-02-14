# Getting Started

## Prerequisites
- Node.js 20+
- pnpm
- Python 3 (for optional search helper)

## Setup
```bash
git clone https://github.com/MohaMehrzad/Sorcerer.git
cd Sorcerer
pnpm install
cp .env.example .env.local
pnpm dev
```

## Validate
```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm build:all
```
