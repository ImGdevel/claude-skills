#!/usr/bin/env bash
# List ~/.claude/skills entries with their kind (link / synced / dir) and basic provenance hints.
# Usage: inventory.sh [skills-dir]   (default: ~/.claude/skills)
set -u
D="${1:-$HOME/.claude/skills}"
[ -d "$D" ] || { echo "no skills dir: $D"; exit 1; }
printf '%-8s %-36s %-11s %s\n' KIND NAME MODIFIED HINT
for p in "$D"/*; do
  n=$(basename "$p")
  if [ -L "$p" ]; then
    printf '%-8s %-36s %-11s -> %s\n' link "$n" "" "$(readlink "$p")"; continue
  fi
  if [ "$n" = synced ]; then
    printf '%-8s %-36s %-11s %s\n' synced "$n" "" "claude.ai account skills: $(ls "$p"/*/ 2>/dev/null | grep -v manifest | tr '\n' ' ')"; continue
  fi
  [ -d "$p" ] || continue
  f="$p/SKILL.md"; hint=""
  if [ -f "$f" ]; then
    hint=$(sed -n '1,/^---$/{/^---$/d;p}' "$f" | sed -n '2,40p' | grep -E '^\s*(author|license|source|homepage|x|site):' | tr -s ' ' | tr '\n' ';')
    m=$(date -r "$f" +%F)
  else
    hint="(no SKILL.md)"; m=""
  fi
  printf '%-8s %-36s %-11s %s\n' dir "$n" "$m" "$hint"
done
