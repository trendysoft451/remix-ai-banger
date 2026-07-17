#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: ./scripts/push-to-github.sh https://github.com/COMPTE/DEPOT.git" >&2
  exit 1
fi

repo_url="$1"
if [[ ! "$repo_url" =~ ^https://github\.com/.+/.+\.git$ ]] && [[ ! "$repo_url" =~ ^git@github\.com:.+/.+\.git$ ]]; then
  echo "URL GitHub invalide: $repo_url" >&2
  exit 1
fi

if [[ ! -d .git ]]; then
  git init
fi

git add .
if ! git diff --cached --quiet; then
  git commit -m "Initial Remix Banger GPT Action"
fi

git branch -M main
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$repo_url"
else
  git remote add origin "$repo_url"
fi

git push -u origin main
echo "Dépôt envoyé vers $repo_url"
