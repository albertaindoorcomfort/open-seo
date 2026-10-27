#!/usr/bin/env bash
# Restore a Lunar Optimize data backup from S3. Run on the box with sudo.
#   restore.sh --list                            the archives in the bucket, oldest first
#   restore.sh <archive|latest> --into <dir>     rehearsal: unpack into a new or empty scratch dir and
#                                                check it; the service and the live data are not touched
#   restore.sh <archive> --live                  replace the live data: it is unpacked and checked beside
#                                                data/ first, then the unit stops, data/ moves aside to
#                                                data.before-restore-<time> (kept, never deleted here),
#                                                the archive takes its place and the unit must serve again
# --live takes an exact archive name, never "latest". Settings as in backup.sh. Prints no secret.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
tmp_dir="${LO_BACKUP_TMP:-/var/tmp}"
usage="usage: restore.sh --list | restore.sh <archive|latest> --into <dir> | restore.sh <archive> --live"

lo_backup_settings
if [ "${1:-}" = --list ]; then
  lo_backup_list
  exit 0
fi
name="${1:-}"
mode="${2:-}"
case "$mode" in --live | --into) ;; *) lo_die "$usage" ;; esac
if [ "$name" = latest ]; then
  [ "$mode" = --into ] || lo_die "--live takes an exact archive name (restore.sh --list shows them)"
  listing="$(lo_backup_list)"
  name="$(printf '%s\n' "$listing" | tail -1)"
fi
[[ $name =~ ^lunar-optimize-data-[0-9]{8}T[0-9]{6}Z-[0-9a-z]+\.tar\.gz$ ]] || lo_die "not an archive name: ${name:-none found}"

work="$(mktemp -d "$tmp_dir/lo-restore.XXXXXX")"
trap 'rm -rf "$work"' EXIT
aws s3 cp "s3://$LO_BUCKET/$LO_PREFIX/$name" "$work/$name" --only-show-errors --no-progress
aws s3 cp "s3://$LO_BUCKET/$LO_PREFIX/$name.sha256" "$work/$name.sha256" --only-show-errors --no-progress
(cd "$work" && sha256sum -c --quiet "$name.sha256") || lo_die "$name does not match its checksum"
listing="$(tar -tvzf "$work/$name")"
# Only plain files and directories under data/: no links, devices or .. in a path.
paths="$(printf '%s\n' "$listing" | awk '{print $6}')"
outside="$(printf '%s\n' "$paths" | grep -cvE '^data(/|$)' || true)"
dotdot="$(printf '%s\n' "$paths" | grep -cE '(^|/)\.\.(/|$)' || true)"
special="$(printf '%s\n' "$listing" | grep -cv '^[-d]' || true)"
[ "$outside" = 0 ] && [ "$dotdot" = 0 ] && [ "$special" = 0 ] ||
  lo_die "$name holds paths outside data/, links or other special files; not restoring it"
need_kb=$(($(printf '%s\n' "$listing" | awk '{s += $3} END {printf "%d", s / 1024}') + 524288))
echo "archive $name checked ($(cut -c1-16 "$work/$name.sha256"))"

# Unpack into $1 (a new or empty dir) and check every database in it.
unpack() {
  local free_kb
  mkdir -p "$1"
  [ -z "$(ls -A "$1")" ] || lo_die "$1 is not empty"
  free_kb="$(df -Pk "$1" | awk 'NR==2 {print $4}')"
  [ "$free_kb" -gt "$need_kb" ] || lo_die "$1 has ${free_kb} KB free; the archive needs ${need_kb} KB with 512 MB to spare"
  tar -xzf "$work/$name" -C "$1"
  lo_verify_data "$1/data" || lo_die "the unpacked data in $1 failed its check"
}

if [ "$mode" = --into ]; then
  into="${3:-}"
  [ -n "$into" ] || lo_die "$usage"
  unpack "$into"
  lo_record "restore-rehearsal $name into $into: checked"
  echo "REHEARSAL OK: $name unpacked into $into/data and checked; the live data was not touched"
  exit 0
fi

lo_lock 0
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
stage="$LO_ROOT/data.restore-$stamp"
aside="$LO_ROOT/data.before-restore-$stamp"
unpack "$stage"
chown -R "$LO_USER:$LO_USER" "$stage/data"
rev="$(lo_link_rev current)"
t0=$SECONDS
sudo systemctl stop "$LO_UNIT"
mv "$LO_ROOT/data" "$aside"
mv "$stage/data" "$LO_ROOT/data"
rmdir "$stage"
sudo systemctl start "$LO_UNIT" || true
if lo_wait_serving "$rev" 180; then
  lo_record "restore $name live; old data at $aside; serving after $((SECONDS - t0))s"
  echo "RESTORED: $name is live and serving after $((SECONDS - t0))s"
  echo "The data it replaced is at $aside. Delete it once the app checks out: sudo rm -rf $aside"
  exit 0
fi
lo_record "restore $name live; NOT serving within 180s; old data at $aside"
lo_journal_tail 40
echo "FAILED: $LO_UNIT is not serving on the restored data. To put the old data back:"
echo "  sudo systemctl stop $LO_UNIT && sudo mv $LO_ROOT/data $LO_ROOT/data.failed-restore-$stamp && sudo mv $aside $LO_ROOT/data && sudo systemctl start $LO_UNIT"
exit 1
