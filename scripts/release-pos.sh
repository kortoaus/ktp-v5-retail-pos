#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/release-pos.sh patch
  ./scripts/release-pos.sh minor
  ./scripts/release-pos.sh major

What it does:
  1. Bumps retail_pos_app/package.json and package-lock.json
  2. Commits the version bump
  3. Creates a matching git tag, such as v1.0.3
  4. Pushes main and the tag to origin
EOF
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

BUMP="$1"
if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  usage
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$REPO_ROOT/retail_pos_app"

cd "$REPO_ROOT"

BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "main" ]]; then
  echo "Release must be run from main. Current branch: $BRANCH" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash changes before releasing." >&2
  git status --short
  exit 1
fi

echo "Bumping POS app version: $BUMP"
VERSION="$(cd "$APP_DIR" && npm version "$BUMP" --no-git-tag-version)"

if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Unexpected version output from npm: $VERSION" >&2
  exit 1
fi

if git rev-parse "$VERSION" >/dev/null 2>&1; then
  echo "Tag already exists locally: $VERSION" >&2
  exit 1
fi

if git ls-remote --exit-code --tags origin "refs/tags/$VERSION" >/dev/null 2>&1; then
  echo "Tag already exists on origin: $VERSION" >&2
  exit 1
fi

git add retail_pos_app/package.json retail_pos_app/package-lock.json
git commit -m "Release $VERSION"
git tag "$VERSION"

git push origin main
git push origin "$VERSION"

echo "Released $VERSION"
echo "Check GitHub Actions: Build Windows Installer"
