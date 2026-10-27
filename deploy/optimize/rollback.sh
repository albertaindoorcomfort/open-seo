#!/usr/bin/env bash
# Lunar Optimize rollback on the Studio box. Run on the box as ubuntu: bash /opt/lunar-optimize/bin/rollback.sh [<sha>]
# Points current at the previous release (or the named one), restarts, and waits until that release
# serves: its REVISION is the one the running process was started from, and the app answers 200.
# Fails unless that happens within 60 seconds of the stop. The previous link then names the release
# rolled back from, so a second run rolls forward again. Data is shared and is never rolled back.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
timeout="${LO_ROLLBACK_TIMEOUT:-60}"

lo_lock 0
from="$(lo_link_rev current)"
[ -n "$from" ] || lo_die "$LO_ROOT/current is missing: install a release with box-install.sh first"
to="${1:-$(lo_link_rev previous)}"
kept="$(find "$LO_ROOT/releases" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%f ' 2>/dev/null || true)"
[ -n "$to" ] || lo_die "no previous release is recorded; name one of: $kept"
lo_valid_rev "$to" && [ -f "$LO_ROOT/releases/$to/REVISION" ] || lo_die "release $to is not on this box; kept: $kept"
[ "$to" != "$from" ] || lo_die "$to is already the current release"

# Migrations only move forward. Name the ones the target release has never seen.
newer="$(comm -13 <(lo_migrations "$to") <(lo_migrations "$from") | tr '\n' ' ')"
if [ -n "$newer" ]; then
  echo "note: the data carries migrations release $to does not have: $newer"
  echo "      they stay applied. If $to cannot run on them, restore the backup taken before $from (README: Restore)."
fi

echo "rolling back $from -> $to (must serve within ${timeout}s)"
if lo_switch "$to" "$timeout"; then
  lo_record "rollback $from -> $to serving after ${LO_WAITED}s"
  echo "ROLLED BACK: release $(cat "$LO_ROOT/current/REVISION") serving after ${LO_WAITED}s; previous is now $from"
  exit 0
fi
lo_record "rollback $from -> $to NOT serving within ${timeout}s"
lo_journal_tail 40
echo "FAILED: release $to is not serving within ${timeout}s (current -> $(lo_link_rev current), previous -> $(lo_link_rev previous))."
echo "To go back: bash $LO_ROOT/bin/rollback.sh $from"
exit 1
