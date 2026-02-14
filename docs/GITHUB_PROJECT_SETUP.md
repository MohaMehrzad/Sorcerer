# GitHub Projects Setup (v2)

The repository can use a Projects v2 board for roadmap visibility, but the current token must include project scopes.

## One-time auth scope upgrade
```bash
gh auth refresh -h github.com -s read:project -s project
```

## Create project
```bash
gh project create --owner MohaMehrzad --title "Sorcerer Roadmap"
```

## Suggested views
- `Roadmap` grouped by status
- `Backlog` sorted by priority
- `Recently shipped` filtered by done items

## Suggested fields
- Status (Todo/In Progress/Blocked/Done)
- Priority (P0-P3)
- Area (runtime/ui/security/docs/community)
- Target release
