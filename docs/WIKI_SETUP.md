# Wiki Setup

Sorcerer keeps wiki source files in `docs/wiki` and can sync them to GitHub Wiki.

## 1. One-time bootstrap in GitHub UI
GitHub does not create the `.wiki.git` remote until the first page exists.

1. Open: `https://github.com/MohaMehrzad/Sorcerer/wiki`
2. Click **Create the first page**
3. Create a simple page (for example: `Home`) and save.

## 2. Sync from local source
After bootstrap, run:

```bash
bash scripts/sync-wiki.sh MohaMehrzad Sorcerer docs/wiki
```

## 3. Automatic sync
Workflow: `.github/workflows/wiki-sync.yml`

- Triggers on changes to `docs/wiki/**` on `main`
- Can also run manually from Actions (`workflow_dispatch`)

## Troubleshooting
- If you see `repository not found` for `.wiki.git`, the bootstrap page was not created yet.
- If workflow cannot push, confirm repo permissions and `contents: write` are enabled.
