#!/usr/bin/env bash
# Sync source from the bind-mount workspace into the Linux-only mirror.
# Run before any build/test inside the container, so that:
#   - node_modules in /home/node/sc-mirror stays Linux-flavor
#   - /workspace/ContactsGit/node_modules belongs to Windows (created by host pnpm install)
# Mirrors source files, NEVER touches node_modules / .git / dist / tsbuildinfo.
set -e

SRC=/workspace/ContactsGit
DST=/home/node/sc-mirror

if [ ! -d "$DST" ]; then
  echo "Mirror $DST does not exist. Bootstrap first:"
  echo "  mkdir -p $DST"
  echo "  cd $SRC && tar --exclude='node_modules' --exclude='.git' --exclude='dist' --exclude='*.tsbuildinfo' -cf - . | (cd $DST && tar -xf -)"
  echo "  cd $DST && pnpm install"
  exit 1
fi

cd "$SRC"

# Use tar to copy preserving permissions and excluding heavy/per-platform dirs.
# Two passes: (1) copy source, (2) prune deletions in mirror that no longer exist in src.
tar --exclude='node_modules' \
    --exclude='.git' \
    --exclude='dist' \
    --exclude='*.tsbuildinfo' \
    -cf - . | (cd "$DST" && tar -xf -)

# Prune files in mirror that were deleted in source (excluding node_modules/dist).
# Use find + diff: list files, compare paths.
SRC_LIST=$(mktemp)
DST_LIST=$(mktemp)
trap "rm -f $SRC_LIST $DST_LIST" EXIT

(cd "$SRC" && find . -type f \
  -not -path './node_modules/*' \
  -not -path './*/node_modules/*' \
  -not -path './.git/*' \
  -not -path './dist/*' \
  -not -path './*/dist/*' \
  -not -name '*.tsbuildinfo' \
  | sort) > "$SRC_LIST"

(cd "$DST" && find . -type f \
  -not -path './node_modules/*' \
  -not -path './*/node_modules/*' \
  -not -path './dist/*' \
  -not -path './*/dist/*' \
  -not -name '*.tsbuildinfo' \
  | sort) > "$DST_LIST"

# Files present in mirror but absent in source — delete from mirror.
comm -23 "$DST_LIST" "$SRC_LIST" | while read -r f; do
  rm -f "$DST/$f"
done

echo "mirror sync complete: $DST"
