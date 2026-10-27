#!/usr/bin/env bash
# One scheduled tick of Lunar Optimize: POST a cron expression to the app's loopback trigger
# (/internal/cron). wrangler dev never fires the worker's crons, so lunar-optimize-cron*.timer run this.
# CRON_TRIGGER_SECRET comes from the unit's EnvironmentFile and reaches curl on stdin, so it never
# shows in a process list or the journal. Exit 0 only on HTTP 200, so a failed tick is a failed unit.
# Usage: cron-tick.sh "<cron expression>"   (LUNAR_OPTIMIZE_URL overrides http://127.0.0.1:3601)
set -euo pipefail
cron="${1:?usage: cron-tick.sh \"<cron expression>\"}"
: "${CRON_TRIGGER_SECRET:?CRON_TRIGGER_SECRET is not set (EnvironmentFile /etc/lunar-optimize/cron.env)}"
base="${LUNAR_OPTIMIZE_URL:-http://127.0.0.1:3601}"
query="${cron// /%20}"
query="${query//\//%2F}"

attempt=0
while :; do
  attempt=$((attempt + 1))
  rc=0
  out="$(printf 'Authorization: Bearer %s\n' "$CRON_TRIGGER_SECRET" |
    curl -sS -H @- -X POST --max-time 300 -w '\n%{http_code}' "$base/internal/cron?cron=$query")" || rc=$?
  # 7 is "could not connect": the app is starting or restarting. Any other result is final.
  if [ "$rc" = 7 ] && [ "$attempt" -lt 5 ]; then sleep 10; continue; fi
  break
done
if [ "$rc" != 0 ]; then echo "cron tick \"$cron\": curl exit $rc"; exit 1; fi
code="${out##*$'\n'}"
echo "cron tick \"$cron\": HTTP $code ${out%$'\n'*}"
[ "$code" = 200 ]
