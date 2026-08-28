#!/usr/bin/env bash
# Copy a work repo locally for offline CodeOracle indexing — never touches company GitHub.
# Usage: ./scripts/mirror-local-repo.sh /path/to/source [mirror-name]
set -euo pipefail

SOURCE="${1:?source path required}"
NAME="${2:-$(basename "$SOURCE")}"
DEST="${CODEORACLE_LOCAL_REPOS_DIR:-$HOME/AlinGod/CodeOracle-local-repos}/$NAME"

mkdir -p "$(dirname "$DEST")"
if [[ -d "$DEST/.git" ]]; then
  echo "Mirror already exists at $DEST — pulling latest from local source only"
  git -C "$SOURCE" fetch --all 2>/dev/null || true
  git clone --local "$SOURCE" "$DEST.tmp" 2>/dev/null || rsync -a --delete --exclude node_modules "$SOURCE/" "$DEST/"
  rm -rf "$DEST.tmp" 2>/dev/null || true
else
  echo "Creating local mirror at $DEST (no network, no personal GitHub PAT on company remote)"
  git clone --local "$SOURCE" "$DEST"
fi

echo "Done. Register with: codeoracle repo register --local-path \"$DEST\" --name \"$NAME\""
