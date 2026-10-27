#!/usr/bin/env bash
# Lunar Optimize install on the Studio box. Runs ON the box as ubuntu, from the kit inside the package:
# ship.sh checks the package, unpacks lunar-optimize/kit/ next to it in /tmp/lo-release and runs this file.
# Each install is a release: /opt/lunar-optimize/releases/<sha>/ (REVISION, app/, node/, runtime/, bin/,
# kit/, smoke.log). The current link names the live one and the previous link the one it replaced;
# rollback.sh flips them back. Data in /opt/lunar-optimize/data is shared by every release and never moves.
# Touches: /opt/lunar-optimize, /etc/systemd/system/lunar-optimize*.{service,timer} and
# /etc/nginx/sites-enabled/optimize.projectlunar.ai. Never touches /opt/mission-control, its pm2 apps,
# or any other nginx site file.
# Stdin: optional DATAFORSEO_API_KEY value (never printed), used only when app.env has no such key.
set -euo pipefail
kit="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$kit/lib.sh"
rel="${LO_SHIP_DIR:-/tmp/lo-release}"
pkg="$rel/lunar-optimize-pkg.tar.gz"
mc_dir="${LO_MC_DIR:-/opt/mission-control}"
seo_state="${LO_SEO_BOX_STATE:-/home/ubuntu/seo-box-state.cjs}"
nginx_site="${LO_NGINX_SITE:-/etc/nginx/sites-enabled/optimize.projectlunar.ai}"
nginx_backup_dir="${LO_NGINX_BACKUP_DIR:-/etc/nginx/backup-lunar-optimize}"
cert="${LO_CERT:-/etc/letsencrypt/live/optimize.projectlunar.ai/fullchain.pem}"
install_timeout="${LO_INSTALL_TIMEOUT:-180}"
dfs=""
if [ ! -t 0 ]; then dfs="$(cat)"; fi

mc_head_before="$(git -C "$mc_dir" rev-parse --short HEAD)"
mc_build_before="$(cat "$mc_dir/.next/BUILD_ID")"
echo "mission-control before: $mc_head_before $mc_build_before"
# Optimize never touches mission-control, so any live revision is fine; it must only not change during the run.

# 1. Pre-checks: nothing deploying, no fresh lock, Studio healthy, no article/layout/video job in flight.
if pgrep -f "ab-cf-deploy|next build|npm (ci|install)|pnpm (install|build)|git (pull|fetch|reset|checkout|merge)" >/dev/null; then echo "STOP: a deploy/build/npm/git process is running"; exit 1; fi
if [ -f /tmp/mc-deploy.lock ]; then
  age=$(( $(date +%s) - $(stat -c %Y /tmp/mc-deploy.lock) ))
  if [ -s /tmp/mc-deploy.lock ] || [ "$age" -lt 600 ]; then echo "STOP: /tmp/mc-deploy.lock is in use or under 10 minutes old (${age}s)"; exit 1; fi
  echo "old empty /tmp/mc-deploy.lock (${age}s) left in place: known leftover"
fi
health="$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:3000/api/health || true)"
if [ "$health" != 200 ]; then echo "STOP: Studio /api/health is $health"; exit 1; fi
state="$(cd "$mc_dir" && node - < "$seo_state")"
echo "$state" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const s=JSON.parse(d);const jobs=s.jobs_in_flight||[];const pipes=Array.isArray(s.pipelines_in_flight)?(s.pipelines_in_flight?.[0]?.n ?? 0):0;console.log("jobs in flight",JSON.stringify(jobs),"pipelines",pipes);if(jobs.length||pipes){console.log("STOP: work in flight");process.exit(1)}})'

# 2. The package: its checksum, a passing smoke log for these exact bytes, and the release it holds.
pkg_sha="$(sha256sum "$pkg" | cut -d' ' -f1)"
[ "$pkg_sha" = "$(cat "$rel/pkg-sha")" ] || lo_die "the package does not match pkg-sha"
if ! grep -qx 'SMOKE PASS' "$rel/smoke.log" 2>/dev/null || ! grep -q "^smoke pkg $pkg_sha " "$rel/smoke.log"; then
  lo_die "no passing smoke.log for this package: run smoke.sh on it and ship its smoke.log"
fi
rev="$(tar -xzf "$pkg" -O lunar-optimize/REVISION | tr -d ' \r\n')"
lo_valid_rev "$rev" || lo_die "the package REVISION is not a commit sha"
echo "package $rev (sha256 ${pkg_sha:0:16})"

# 3. Pre-deploy backup, when the backup is installed and configured (README: Backup).
if [ "${LO_SKIP_BACKUP:-0}" != 1 ] && [ -f "$LO_SYSTEMD_DIR/lunar-optimize-backup.service" ] && sudo test -s "$LO_BACKUP_ENV"; then
  echo "pre-deploy backup"
  sudo systemctl start lunar-optimize-backup.service ||
    lo_die "the pre-deploy backup failed (sudo journalctl -u lunar-optimize-backup); LO_SKIP_BACKUP=1 deploys without one"
else
  echo "pre-deploy backup: none (backup not installed or not configured, or LO_SKIP_BACKUP=1)"
fi

# 4. Where things stand. A release-layout box has the current link; the 2026-10-21 install has app/,
# node/ and runtime/ directly under /opt/lunar-optimize and is moved into releases/<its sha> below.
sudo mkdir -p "$LO_ROOT"
sudo chown "$LO_USER:$LO_USER" "$LO_ROOT"
lo_lock 0
mkdir -p "$LO_ROOT/releases" "$LO_ROOT/data" "$LO_ROOT/bin" "$LO_ROOT/.config"
rm -rf "$LO_ROOT"/releases/.incoming-*
cur="$(lo_link_rev current)"
prev="$(lo_link_rev previous)"
legacy=""
if [ -z "$cur" ] && [ -f "$LO_ROOT/app/REVISION" ]; then
  legacy="$(tr -d ' \r\n' <"$LO_ROOT/app/REVISION")"
  lo_valid_rev "$legacy" || lo_die "the live install's app/REVISION is not a commit sha; move it by hand first"
  for d in app node runtime; do [ -d "$LO_ROOT/$d" ] || lo_die "the live install has no $d/; move it by hand first"; done
  [ "$legacy" != "$rev" ] || lo_die "the live install is already $rev; ship a newer commit for the first release-layout install"
  [ ! -e "$LO_ROOT/releases/$legacy" ] || lo_die "releases/$legacy exists beside a live install of $legacy; move one of them"
fi
dir="$LO_ROOT/releases/$rev"
reuse=0
if [ -d "$dir" ]; then
  [ "$(cat "$dir/PKG_SHA256" 2>/dev/null)" = "$pkg_sha" ] ||
    lo_die "releases/$rev exists from a different package; roll away from it and remove it, or ship a new commit"
  reuse=1
fi

# 5. Room. Keep the current and previous releases (and this one if it is already here); remove the rest,
# then require 1.5 GB free after unpacking.
for old in "$LO_ROOT"/releases/*/; do
  old="$(basename "$old")"
  if [ "$old" = "*" ] || [ "$old" = "$cur" ] || [ "$old" = "$prev" ] || { [ "$old" = "$rev" ] && [ "$reuse" = 1 ]; }; then continue; fi
  rm -rf "${LO_ROOT:?}/releases/$old"
  echo "removed old release $old"
done
npm cache clean --force >/dev/null 2>&1 || true
sudo apt-get clean
free_mb=$(df -BM --output=avail "$LO_ROOT" | tail -1 | tr -dc 0-9)
# The bundled runtime must be the Node version pinned in the release's .nvmrc (the repo's pin).
check_node() {
  local want have
  want="v$(tr -d ' \r\nv' <"$1/.nvmrc")"
  have="$("$1/node/bin/node" -v)"
  if [ "$have" != "$want" ]; then
    echo "STOP: the package bundles Node $have, but its .nvmrc pins $want" >&2
    return 1
  fi
  echo "node $have (pinned)"
}
if [ "$reuse" = 1 ]; then
  echo "release $rev already unpacked (same package); reusing it; free ${free_mb} MB"
  check_node "$dir" || exit 1
else
  pkg_mb=$(( $(gzip -l "$pkg" | awk 'NR==2{print $2}') / 1048576 ))
  echo "free ${free_mb} MB, package unpacks to ${pkg_mb} MB"
  if [ $(( free_mb - pkg_mb - 100 )) -lt 1536 ]; then lo_die "would leave under 1.5 GB free"; fi
  incoming="$LO_ROOT/releases/.incoming-$$"
  mkdir "$incoming"
  tar -xzf "$pkg" -C "$incoming" --strip-components=1
  check_node "$incoming" || { rm -rf "$incoming"; exit 1; }
  printf '%s\n' "$pkg_sha" >"$incoming/PKG_SHA256"
  mv -T "$incoming" "$dir"
fi
cp "$rel/smoke.log" "$dir/smoke.log"

# 6. Settings file. Merged, never rewritten: an existing name is kept with its value, hand-added names
# stay, and only missing names are added. Names only in output; the file stays mode 600. To change a
# value later: bin/env-set.sh NAME < file. Defaults are added when the name is missing:
env_defaults=(
  "AUTH_MODE=hosted"
  "BETTER_AUTH_URL=https://optimize.projectlunar.ai"
  "LUNAR_OPTIMIZE_CHECKOUT_ENABLED=false"
  "LUNAR_OPTIMIZE_ALLOWED_EMAILS=DigitalTools.Mgt@albertaindoorcomfort.com"
  "LUNAR_OPTIMIZE_DAILY_USD=2"
  "OPENSEO_TELEMETRY_DISABLED=1"
)
# Secrets generated once, when the name is missing, and preserved on every later install.
env_generated=(BETTER_AUTH_SECRET CRON_TRIGGER_SECRET)  # CRON_TRIGGER_SECRET: P0-2 loopback cron trigger
for entry in "${env_defaults[@]}"; do lo_env_add_missing "$LO_ENV_FILE" "${entry%%=*}" "${entry#*=}"; done
for name in "${env_generated[@]}"; do
  if lo_env_has "$LO_ENV_FILE" "$name"; then echo "app.env: kept $name"; else lo_env_add_missing "$LO_ENV_FILE" "$name" "$(lo_new_secret)"; fi
done
dfs="${dfs%$'\r'}"
if [[ $dfs == *$'\n'* ]]; then
  echo "DataForSEO: the value on stdin has more than one line; not used"
elif [ -n "$dfs" ] && lo_env_has "$LO_ENV_FILE" DATAFORSEO_API_KEY; then
  echo "app.env: kept DATAFORSEO_API_KEY (the value on stdin is not used; env-set.sh changes it)"
elif [ -n "$dfs" ]; then
  lo_env_add_missing "$LO_ENV_FILE" DATAFORSEO_API_KEY "$dfs"
fi
unset dfs
chmod 600 "$LO_ENV_FILE"
if lo_env_has "$LO_ENV_FILE" DATAFORSEO_API_KEY; then echo "DataForSEO: key present (live data, 2 USD/day ceiling)"; else echo "DataForSEO: no key (sample mode)"; fi
echo "app.env names: $(lo_env_names "$LO_ENV_FILE" | tr '\n' ' ')"

# 7. Operator scripts in /opt/lunar-optimize/bin, from this release's kit.
install -m 755 "$kit/rollback.sh" "$kit/backup.sh" "$kit/restore.sh" "$kit/env-set.sh" "$LO_ROOT/bin/"
install -m 644 "$kit/lib.sh" "$LO_ROOT/bin/lib.sh"

# 8. Switch while the unit is stopped, then wait until this release serves. On failure, go back to
# the release it replaced.
switch_failed() {
  echo "STOP: the install failed while $LO_UNIT was stopped (current -> $(lo_link_rev current), previous -> $(lo_link_rev previous)); starting it again"
  sudo systemctl start "$LO_UNIT" || true
}
trap switch_failed EXIT
t0=$SECONDS
if [ -f "$LO_SYSTEMD_DIR/$LO_UNIT.service" ]; then sudo systemctl stop "$LO_UNIT"; fi
if [ -n "$legacy" ]; then
  ldir="$LO_ROOT/releases/$legacy"
  mkdir "$ldir"
  mv "$LO_ROOT/app" "$LO_ROOT/node" "$LO_ROOT/runtime" "$ldir/"
  mkdir "$ldir/bin"
  install -m 755 "$dir/bin/run.sh" "$dir/bin/migrate.sh" "$ldir/bin/"
  printf '%s\n' "$legacy" >"$ldir/REVISION"
  rm -f "$LO_ROOT/bin/run.sh" "$LO_ROOT/bin/migrate.sh"
  echo "the live install moved to releases/$legacy"
fi
from="${cur:-$legacy}"
if [ -n "$from" ] && [ "$from" != "$rev" ]; then lo_set_link previous "$from"; fi
lo_set_link current "$rev"
sudo install -m 644 "$kit/lunar-optimize.service" "$LO_SYSTEMD_DIR/$LO_UNIT.service"
# Egress rule (P0-4): installed only when a transient unit under the same rule still reaches public
# HTTPS and DNS, and is refused the metadata address. Otherwise it is left out and the install says so.
egress_dropin="$LO_SYSTEMD_DIR/$LO_UNIT.service.d/egress.conf"
egress_deny="$(sed -n 's/^IPAddressDeny=//p' "$kit/lunar-optimize.service.d-egress.conf")"
egress_probe() {
  sudo systemd-run --quiet --wait --pipe --collect -p User="$LO_USER" -p IPAddressDeny="$egress_deny" -- "$@"
}
if ! command -v systemd-run >/dev/null; then
  echo "egress rule: skipped (no systemd-run)"
elif grep -E '^nameserver' /etc/resolv.conf | grep -qv '127\.0\.0\.53'; then
  echo "egress rule: skipped (/etc/resolv.conf names a resolver other than 127.0.0.53, which the rule would cut off)"
elif [ "$(egress_probe curl -s -o /dev/null -m 10 -w '%{http_code}' -H 'accept: application/dns-json' 'https://cloudflare-dns.com/dns-query?name=example.com&type=A' || true)" != 200 ]; then
  echo "egress rule: skipped (public DNS over HTTPS failed under the rule)"
elif egress_probe curl -s -o /dev/null -m 3 http://169.254.169.254/ 2>/dev/null; then
  echo "egress rule: skipped (the metadata address was still reachable under the rule)"
else
  sudo install -d -m 755 "$(dirname "$egress_dropin")"
  sudo install -m 644 "$kit/lunar-optimize.service.d-egress.conf" "$egress_dropin"
  echo "egress rule: installed ($egress_dropin)"
fi
sudo systemctl daemon-reload
sudo systemctl enable "$LO_UNIT"
sudo systemctl start "$LO_UNIT" || true
trap - EXIT
if lo_wait_serving "$rev" "$install_timeout"; then
  lo_record "install $rev pkg ${pkg_sha:0:16} previous ${from:-none} serving after $((SECONDS - t0))s"
  echo "release $rev serving on 127.0.0.1:$LO_PORT, $((SECONDS - t0))s after the stop (previous: ${from:-none})"
else
  echo "STOP: release $rev did not serve within ${install_timeout}s"
  lo_journal_tail 40
  back="$(lo_link_rev previous)"
  if [ -n "$back" ] && [ "$back" != "$rev" ] && lo_switch "$back" "${LO_ROLLBACK_TIMEOUT:-60}"; then
    lo_record "install $rev failed; rolled back to $back serving after ${LO_WAITED}s"
    echo "rolled back to $back, serving after ${LO_WAITED}s"
  else
    lo_record "install $rev failed; no release serving"
    echo "no release is serving: see the log above, then bash $LO_ROOT/bin/rollback.sh <sha>"
  fi
  exit 1
fi

# 9. Sub-installers: one line each, run from this release's kit after it serves. Each sources lib.sh.
bash "$kit/install-backup.sh"
LUNAR_OPTIMIZE_ROOT="$LO_ROOT" LUNAR_OPTIMIZE_ETC="$LO_ETC_DIR" SYSTEMD_UNIT_DIR="$LO_SYSTEMD_DIR" \
  bash "$kit/install-timers.sh"  # P0-2: cron timers; copies CRON_TRIGGER_SECRET from app.env to /etc/lunar-optimize/cron.env

# 10. nginx site: installed only when it changed, checked with nginx -t, and the old file put back if
# the check fails. certbot is not run here: the certificate exists, and certbot collides with the box's
# own renew timer ("Another instance of Certbot is already running").
if cmp -s "$kit/optimize.projectlunar.ai.nginx" "$nginx_site"; then
  echo "nginx site unchanged"
else
  sudo test -s "$cert" || lo_die "no certificate at $cert; issue it first (README: First TLS)"
  sudo mkdir -p "$nginx_backup_dir"
  bak=""
  if sudo test -e "$nginx_site"; then
    bak="$nginx_backup_dir/optimize.projectlunar.ai.$(date -u +%Y%m%dT%H%M%SZ)"
    sudo cp -p "$nginx_site" "$bak"
  fi
  sudo install -m 644 "$kit/optimize.projectlunar.ai.nginx" "$nginx_site"
  if ! sudo nginx -t; then
    if [ -n "$bak" ]; then sudo cp -p "$bak" "$nginx_site"; else sudo rm -f "$nginx_site"; fi
    lo_die "nginx -t failed; the previous site file is back"
  fi
  sudo systemctl reload nginx
  echo "nginx site updated (previous file: ${bak:-none})"
fi

# 11. After-state.
echo "mission-control after: $(git -C "$mc_dir" rev-parse --short HEAD) $(cat "$mc_dir/.next/BUILD_ID")"
if [ "$(git -C "$mc_dir" rev-parse --short HEAD)" = "$mc_head_before" ] && [ "$(cat "$mc_dir/.next/BUILD_ID")" = "$mc_build_before" ]; then echo "mission-control unchanged"; else echo "STOP: mission-control HEAD/BUILD_ID changed during the run (another deploy?); Optimize is installed, check before trusting either"; exit 1; fi
for u in https://studio.projectlunar.ai/api/health https://mission-control.projectlunar.ai/ https://optimize.projectlunar.ai/sign-in; do echo "$u $(curl -s -o /dev/null -m 10 -w '%{http_code}' "$u")"; done
free -m | awk '/Mem/{print "memory available MB", $7, "of", $2}'
systemctl show "$LO_UNIT" -p MemoryCurrent -p MemoryMax | tr '\n' ' '; echo
df -h "$LO_ROOT" | tail -1
echo "releases: $(find "$LO_ROOT/releases" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%f ')(current $(lo_link_rev current), previous $(lo_link_rev previous))"
rm -f "$pkg"
echo "DONE"
