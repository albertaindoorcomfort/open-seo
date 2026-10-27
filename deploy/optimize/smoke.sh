#!/usr/bin/env bash
# WSL smoke test of the exact package: unpack to a scratch root, migrate, start, probe, stop.
# Everything it prints is also saved as smoke.log next to the package. ship.sh ships that log,
# box-install.sh refuses a package without a passing one, and keeps it as releases/<sha>/smoke.log.
set -euo pipefail
rel="${LO_OUT_DIR:-/mnt/c/Users/XanderGamelo/.LunarProjectPrime/.tmp/cf/lo-release}"
root="${LO_SMOKE_ROOT:-/var/tmp/lo-smoke}"
rm -f "$rel/smoke.log"
exec > >(tee "$rel/smoke.log") 2>&1
tee_pid=$!
trap 'exec >&- 2>&-; wait "$tee_pid"' EXIT
pkg_sha="$(sha256sum "$rel/lunar-optimize-pkg.tar.gz" | cut -d' ' -f1)"
[ "$pkg_sha" = "$(cat "$rel/pkg-sha")" ] || { echo "STOP: the package does not match pkg-sha"; exit 1; }
rm -rf "$root"; mkdir -p "$root/release" "$root/data" "$root/.config"
tar -xzf "$rel/lunar-optimize-pkg.tar.gz" -C "$root/release" --strip-components=1
echo "smoke pkg $pkg_sha rev $(cat "$root/release/REVISION") node $("$root/release/node/bin/node" -v)"
umask 077
printf 'AUTH_MODE=hosted\nBETTER_AUTH_URL=http://localhost:3611\nBETTER_AUTH_SECRET=%s\nLUNAR_OPTIMIZE_CHECKOUT_ENABLED=false\nOPENSEO_TELEMETRY_DISABLED=1\n' "$(openssl rand -hex 32)" > "$root/app.env"
export LO_PORT=3611 LO_DATA_DIR="$root/data" LO_ENV_FILE="$root/app.env"
export PATH="$root/release/node/bin:$PATH" HOME="$root" XDG_CONFIG_HOME="$root/.config" WRANGLER_SEND_METRICS=false CI=1
"$root/release/bin/migrate.sh" > "$rel/smoke-migrate.log" 2>&1 || { tail -20 "$rel/smoke-migrate.log"; exit 1; }
tail -2 "$rel/smoke-migrate.log"
"$root/release/bin/run.sh" > "$rel/smoke-run.log" 2>&1 &
pid=$!
ok=0
for _ in $(seq 1 60); do
  c="$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:3611/sign-in || true)"
  [ "$c" = 200 ] && { ok=1; break; }
  sleep 2
done
echo "sign-in $c"
curl -s -X POST http://127.0.0.1:3611/api/auth/sign-up/email -H 'content-type: application/json' -H 'origin: http://localhost:3611' \
  -d '{"name":"x","email":"someone@example.org","password":"Placeholder-test-1234"}' -w ' HTTP %{http_code}\n'
ps -o rss= -p $pid | awk '{print "wrangler rss MB", int($1/1024)}'
{ pgrep -f workerd || true; } | xargs -r ps -o rss= -p | awk '{s+=$1} END {print "workerd rss MB", int(s/1024)}'
kill $pid; sleep 2; pkill -f "$root" || true
[ "$ok" = 1 ] || { tail -30 "$rel/smoke-run.log"; exit 1; }
echo SMOKE PASS
