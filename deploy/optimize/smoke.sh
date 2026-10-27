#!/usr/bin/env bash
# WSL smoke test of the exact package: unpack to a scratch root, migrate, start, probe, stop.
set -euo pipefail
rel=/mnt/c/Users/XanderGamelo/.LunarProjectPrime/.tmp/cf/lo-release
root=/var/tmp/lo-smoke
rm -rf "$root"; mkdir -p "$root"
tar -xzf "$rel/lunar-optimize-pkg.tar.gz" -C "$root" --strip-components=1
mkdir -p "$root/data" "$root/bin" "$root/.config"
for f in run.sh migrate.sh; do sed "s#/opt/lunar-optimize#$root#g; s#--port 3601#--port 3611#" "$rel/$f" > "$root/bin/$f"; chmod +x "$root/bin/$f"; done
umask 077
printf 'AUTH_MODE=hosted\nBETTER_AUTH_URL=http://localhost:3611\nBETTER_AUTH_SECRET=%s\nLUNAR_OPTIMIZE_CHECKOUT_ENABLED=false\nOPENSEO_TELEMETRY_DISABLED=1\n' "$(openssl rand -hex 32)" > "$root/app.env"
printf 'CRON_TRIGGER_SECRET=%s\n' "$(openssl rand -hex 32)" >> "$root/app.env"  # P0-2: lets the health block below run one real tick
export PATH="$root/node/bin:$PATH" HOME="$root" XDG_CONFIG_HOME="$root/.config" WRANGLER_SEND_METRICS=false CI=1
"$root/bin/migrate.sh" > "$rel/smoke-migrate.log" 2>&1 || { tail -20 "$rel/smoke-migrate.log"; exit 1; }
tail -2 "$rel/smoke-migrate.log"
"$root/bin/run.sh" > "$rel/smoke-run.log" 2>&1 &
pid=$!
ok=0
for i in $(seq 1 60); do
  c="$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:3611/sign-in || true)"
  [ "$c" = 200 ] && { ok=1; break; }
  sleep 2
done
echo "sign-in $c"
curl -s -X POST http://127.0.0.1:3611/api/auth/sign-up/email -H 'content-type: application/json' -H 'origin: http://localhost:3611' \
  -d '{"name":"x","email":"someone@example.org","password":"Placeholder-test-1234"}' -w ' HTTP %{http_code}\n'
ps -o rss= -p $pid | awk '{print "wrangler rss MB", int($1/1024)}'
pgrep -f workerd | xargs -r ps -o rss= -p | awk '{s+=$1} END {print "workerd rss MB", int(s/1024)}'
# --- P0-2: health and the cron trigger (own block; failures set ok=0) ---
# Ready means the migrated tables, KV and R2 answer. One real "*/5" tick goes through cron-tick.sh, the
# script the box timers run. The public host must answer /internal/ with 404 (nginx); SMOKE_PUBLIC_URL=
# (empty) skips that check when offline.
c="$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:3611/health/ready || true)"
echo "health/ready $c"; [ "$c" = 200 ] || ok=0
c="$(curl -s -o /dev/null -m 10 -w '%{http_code}' -X POST 'http://127.0.0.1:3611/internal/cron?cron=*%2F5%20*%20*%20*%20*' || true)"
echo "internal/cron without the secret $c"; [ "$c" = 401 ] || ok=0
CRON_TRIGGER_SECRET="$(sed -n 's/^CRON_TRIGGER_SECRET=//p' "$root/app.env")" LUNAR_OPTIMIZE_URL=http://127.0.0.1:3611 \
  bash "$rel/cron-tick.sh" "*/5 * * * *" || ok=0
public="${SMOKE_PUBLIC_URL-https://optimize.projectlunar.ai}"
if [ -n "$public" ]; then
  c="$(curl -s -o /dev/null -m 10 -w '%{http_code}' -X POST "$public/internal/cron?cron=*%2F5%20*%20*%20*%20*" || true)"
  echo "public internal/cron $c"; [ "$c" = 404 ] || ok=0
fi
# --- end P0-2 block ---
kill $pid; sleep 2; pkill -f "$root" || true
[ "$ok" = 1 ] || { tail -30 "$rel/smoke-run.log"; exit 1; }
echo SMOKE PASS
