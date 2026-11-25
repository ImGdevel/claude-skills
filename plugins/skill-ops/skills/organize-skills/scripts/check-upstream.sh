#!/usr/bin/env bash
# For each local skill folder, check whether every file's exact content exists somewhere in the
# upstream repo's git history. All "in-history" = the local copy is just an older upstream version
# (safe to replace with the upstream plugin). Any NOT-IN-HISTORY file = possibly a local edit.
# Usage: check-upstream.sh <upstream-git-url> <local-skill-dir>...
set -u
[ $# -ge 2 ] || { echo "usage: $0 <upstream-git-url> <local-skill-dir>..."; exit 2; }
url=$1; shift
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
git clone -q --filter=blob:none --no-checkout "$url" "$T/up" || { echo "clone failed: $url"; exit 1; }
# list every blob id reachable in history (fetches blobs lazily only for ids, not content)
git -C "$T/up" rev-list --all --objects --missing=print | awk '{sub(/^\?/,"",$1); print $1}' | sort -u > "$T/objs"
total_bad=0
for d in "$@"; do
  name=$(basename "$d"); bad=0; cnt=0
  while IFS= read -r -d '' f; do
    cnt=$((cnt+1))
    h=$(git hash-object "$f")
    if ! grep -qx "$h" "$T/objs"; then echo "  NOT-IN-HISTORY $name/${f#$d/}"; bad=$((bad+1)); fi
  done < <(find "$d" -type f -not -path '*/__pycache__/*' -print0)
  [ $bad -eq 0 ] && echo "in-history     $name ($cnt files)" || echo "MODIFIED?      $name ($bad of $cnt files not in upstream history)"
  total_bad=$((total_bad+bad))
done
exit $([ $total_bad -eq 0 ] && echo 0 || echo 3)
