#!/usr/bin/env bash
set -euo pipefail

OWNER="${1:-MohaMehrzad}"
REPO="${2:-Sorcerer}"
SOURCE_DIR="${3:-docs/wiki}"
WIKI_URL="https://github.com/${OWNER}/${REPO}.wiki.git"

if [[ ! -d "${SOURCE_DIR}" ]]; then
  echo "Source directory not found: ${SOURCE_DIR}" >&2
  exit 1
fi

if ! git ls-remote "${WIKI_URL}" >/dev/null 2>&1; then
  echo "Wiki repository does not exist yet. Create the first wiki page in GitHub UI, then rerun." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

git clone "${WIKI_URL}" "${tmp_dir}/wiki" >/dev/null 2>&1

rsync -a --delete --exclude '.git' "${SOURCE_DIR}/" "${tmp_dir}/wiki/"

cd "${tmp_dir}/wiki"
if [[ -z "$(git status --porcelain)" ]]; then
  echo "Wiki is already up to date."
  exit 0
fi

git add .
git commit -m "docs(wiki): sync from ${SOURCE_DIR}" >/dev/null
git push origin HEAD >/dev/null

echo "Wiki synchronized successfully."
