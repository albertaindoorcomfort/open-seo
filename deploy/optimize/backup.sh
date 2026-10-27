#!/usr/bin/env bash
# Lunar Optimize data backup to S3. lunar-optimize-backup.timer runs it nightly as root; run it by hand
# with: sudo systemctl start lunar-optimize-backup.service
#
# Consistency: a short stop, not a live copy. The store is miniflare's: SQLite files in WAL mode for D1,
# KV, R2 and the Durable Objects, plus KV and R2 blob files that must match their SQLite indexes. A copy
# taken while workerd writes can catch a database mid-transaction or an index without its blob, and a
# per-file sqlite3 .backup would still not make the set agree with itself (there is no LVM or btrfs on
# the box for a snapshot). So the unit stops for one tar of data/, starts again, and the archive is
# checked, uploaded and pruned while the app serves. The log line gives the seconds it was down.
#
# Settings (names; values in /etc/lunar-optimize/backup.env or the environment):
#   LUNAR_OPTIMIZE_BACKUP_BUCKET     required, the S3 bucket
#   LUNAR_OPTIMIZE_BACKUP_PREFIX     key prefix, default lunar-optimize/data
#   LUNAR_OPTIMIZE_BACKUP_KEEP_DAYS  days to keep, default 14 (the newest 3 archives are always kept)
#   AWS_PROFILE, AWS_REGION          optional; the instance role is used otherwise
# Prints no secret: names, sizes, a checksum and timings only. app.env is not in the archive.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
keep_min=3
tmp_dir="${LO_BACKUP_TMP:-/var/tmp}"

lo_backup_settings
[ -d "$LO_ROOT/data" ] || lo_die "no data directory at $LO_ROOT/data"
lo_lock 900

data_kb="$(du -sk "$LO_ROOT/data" | cut -f1)"
free_kb="$(df -Pk "$tmp_dir" | awk 'NR==2 {print $4}')"
[ "$free_kb" -gt $((data_kb + 524288)) ] ||
  lo_die "$tmp_dir has ${free_kb} KB free; the data is ${data_kb} KB and 512 MB must stay free"

rev="$(lo_link_rev current)"
tag="${rev:0:12}"
name="lunar-optimize-data-$(date -u +%Y%m%dT%H%M%SZ)-${tag:-unknown}.tar.gz"
archive="$tmp_dir/$name"

was_active=0
started=0
start_again() {
  if [ "$was_active" = 1 ] && [ "$started" = 0 ]; then
    started=1
    sudo systemctl start "$LO_UNIT" || true
  fi
}
trap 'start_again; rm -f "$archive" "$archive.sha256"' EXIT
trap 'exit 1' HUP INT TERM

case "$(systemctl is-active "$LO_UNIT" || true)" in active | activating | reloading) was_active=1 ;; esac
t0=$SECONDS
if [ "$was_active" = 1 ]; then sudo systemctl stop "$LO_UNIT"; fi
tar -C "$LO_ROOT" -cf - data | gzip -1 >"$archive"
start_again
down=$((SECONDS - t0))

gzip -t "$archive"
(cd "$tmp_dir" && sha256sum "$name") >"$archive.sha256"
size_mb=$(($(stat -c %s "$archive") / 1048576))
aws s3 cp "$archive" "s3://$LO_BUCKET/$LO_PREFIX/$name" --only-show-errors --no-progress
aws s3 cp "$archive.sha256" "s3://$LO_BUCKET/$LO_PREFIX/$name.sha256" --only-show-errors --no-progress
echo "backup: s3://$LO_BUCKET/$LO_PREFIX/$name (${size_mb} MB, sha256 $(cut -c1-16 "$archive.sha256")), service down ${down}s"

# Keep LO_KEEP_DAYS days of archives, and never fewer than the newest $keep_min however old they are.
listing="$(lo_backup_list)"
names=()
if [ -n "$listing" ]; then mapfile -t names <<<"$listing"; fi
cutoff="lunar-optimize-data-$(date -u -d "-$LO_KEEP_DAYS days" +%Y%m%dT%H%M%SZ)"
pruned=0
for ((i = 0; i < ${#names[@]} - keep_min; i++)); do
  old="${names[i]}"
  if [[ $old < $cutoff ]]; then
    aws s3 rm "s3://$LO_BUCKET/$LO_PREFIX/$old" --only-show-errors
    aws s3 rm "s3://$LO_BUCKET/$LO_PREFIX/$old.sha256" --only-show-errors
    pruned=$((pruned + 1))
  fi
done
echo "pruned $pruned archive(s) older than $LO_KEEP_DAYS days; $((${#names[@]} - pruned)) kept"

if [ "$was_active" = 1 ]; then
  lo_wait_serving "$rev" 180 || {
    lo_record "backup $name down ${down}s; NOT serving again within 180s"
    lo_die "the archive is uploaded, but $LO_UNIT is not serving again within 180s"
  }
  echo "serving again"
fi
lo_record "backup $name ${size_mb}MB down ${down}s pruned $pruned"
