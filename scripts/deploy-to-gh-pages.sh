#!/bin/bash
set -e

# Deploy the website directory to gh-pages branch on dgriffith/minerva
# Usage: ./scripts/deploy-to-gh-pages.sh

REPO_URL="https://github.com/dgriffith/minerva"
BRANCH="gh-pages"
WORKTREE_DIR=".gh-pages-deploy"

echo "🚀 Deploying website to $REPO_URL ($BRANCH branch)..."

# Verify the website directory exists
if [[ ! -d "website" ]]; then
  echo "❌ website/ directory not found"
  exit 1
fi

# Clean up any existing worktree from a previous failed deploy
if [[ -d "$WORKTREE_DIR" ]]; then
  git worktree remove "$WORKTREE_DIR" 2>/dev/null || true
fi

# Fetch the gh-pages branch from the minerva repo
echo "📥 Fetching $BRANCH from remote..."
git fetch "$REPO_URL" "$BRANCH:$BRANCH" 2>/dev/null || true

# Create or checkout gh-pages in a worktree
if git rev-parse "$BRANCH" &>/dev/null; then
  # Branch exists locally (was fetched)
  git worktree add "$WORKTREE_DIR" "$BRANCH"
else
  # Branch doesn't exist, create it as an orphan
  echo "🆕 Creating new $BRANCH branch..."
  git worktree add --orphan "$WORKTREE_DIR" -b "$BRANCH"
fi

# Clear the worktree and copy website files
rm -rf "$WORKTREE_DIR"/*
cp -r website/* "$WORKTREE_DIR/"

# Commit and push
cd "$WORKTREE_DIR"
git add .
if git diff --cached --quiet; then
  echo "✅ No changes to deploy"
else
  git commit -m "Deploy website from $(git rev-parse --short HEAD~0 2>/dev/null || echo 'current')"
  git push "$REPO_URL" "$BRANCH"
  echo "✅ Deployed website to $BRANCH branch"
fi
cd -

# Clean up
git worktree remove "$WORKTREE_DIR"
