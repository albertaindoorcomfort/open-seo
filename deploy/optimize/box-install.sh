#!/usr/bin/env bash
# Lunar Optimize install on the Studio box (2026-10-21). Runs ON the box as ubuntu, from /tmp/lo-release.
# Touches: /opt/lunar-optimize (new), /etc/systemd/system/lunar-optimize.service (new),
# /etc/nginx/sites-enabled/optimize.projectlunar.ai (new), a certbot cert for optimize.projectlunar.ai only.
# Never touches /opt/mission-control, its pm2 apps, or any existing nginx site file.
# Stdin: optional DATAFORSEO_API_KEY value (never printed). Empty stdin = sample mode.
set -euo pipefail
rel=/tmp/lo-release
dst=/opt/lunar-optimize
mc_head_before="$(git -C /opt/mission-control rev-parse --short HEAD)"
mc_build_before="$(cat /opt/mission-control/.next/BUILD_ID)"
echo "mission-control before: $mc_head_before $mc_build_before"
# Optimize never touches mission-control, so any live revision is fine; it must only not change during the run.

# 1. Pre-checks: nothing deploying, no fresh lock, Studio healthy, no article/layout/video job in flight.
if ps -eo args | grep -E "ab-cf-deploy|next build|npm (ci|install)|pnpm (install|build)|git (pull|fetch|reset|checkout|merge)" | grep -v grep >/dev/null; then echo "STOP: a deploy/build/npm/git process is running"; exit 1; fi
if [ -f /tmp/mc-deploy.lock ]; then
  age=$(( $(date +%s) - $(stat -c %Y /tmp/mc-deploy.lock) ))
  if [ -s /tmp/mc-deploy.lock ] || [ "$age" -lt 600 ]; then echo "STOP: /tmp/mc-deploy.lock is in use or under 10 minutes old (${age}s)"; exit 1; fi
  echo "old empty /tmp/mc-deploy.lock (${age}s) left in place: known leftover"
fi
health="$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:3000/api/health || true)"
if [ "$health" != 200 ]; then echo "STOP: Studio /api/health is $health"; exit 1; fi
state="$(cd /opt/mission-control && node - < /home/ubuntu/seo-box-state.cjs)"
echo "$state" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const s=JSON.parse(d);const jobs=s.jobs_in_flight||[];const pipes=Array.isArray(s.pipelines_in_flight)?(s.pipelines_in_flight?.[0]?.n ?? 0):0;console.log("jobs in flight",JSON.stringify(jobs),"pipelines",pipes);if(jobs.length||pipes){console.log("STOP: work in flight");process.exit(1)}})'

# 2. Room: clear caches, then require 1.5 GB free after the install.
npm cache clean --force >/dev/null 2>&1 || true
sudo apt-get clean
pkg_mb=$(( $(gzip -l "$rel/lunar-optimize-pkg.tar.gz" | awk 'NR==2{print $2}') / 1048576 ))
free_mb=$(df -BM --output=avail / | tail -1 | tr -dc 0-9)
echo "free ${free_mb} MB, package unpacks to ${pkg_mb} MB"
if [ $(( free_mb - pkg_mb - 100 )) -lt 1536 ]; then echo "STOP: would leave under 1.5 GB free"; exit 1; fi

# 3. Install.
test "$(sha256sum "$rel/lunar-optimize-pkg.tar.gz" | cut -d' ' -f1)" = "$(cat "$rel/pkg-sha")"
sudo mkdir -p "$dst"; sudo chown ubuntu:ubuntu "$dst"
rm -rf "$dst/app" "$dst/node" "$dst/runtime"
tar -xzf "$rel/lunar-optimize-pkg.tar.gz" -C "$dst" --strip-components=1
mkdir -p "$dst/data" "$dst/bin" "$dst/.config"
install -m 755 "$rel/run.sh" "$dst/bin/run.sh"
install -m 755 "$rel/migrate.sh" "$dst/bin/migrate.sh"

# 4. Settings file (names only in output). Keeps an existing BETTER_AUTH_SECRET.
env_file="$dst/app.env"
old_secret=""
[ -f "$env_file" ] && old_secret="$(grep '^BETTER_AUTH_SECRET=' "$env_file" | cut -d= -f2- || true)"
dfs="$(cat || true)"
umask 077
{
  echo "AUTH_MODE=hosted"
  echo "BETTER_AUTH_URL=https://optimize.projectlunar.ai"
  echo "BETTER_AUTH_SECRET=${old_secret:-$(openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-64)}"
  echo "LUNAR_OPTIMIZE_CHECKOUT_ENABLED=false"
  echo "LUNAR_OPTIMIZE_ALLOWED_EMAILS=DigitalTools.Mgt@albertaindoorcomfort.com"
  echo "LUNAR_OPTIMIZE_DAILY_USD=2"
  echo "OPENSEO_TELEMETRY_DISABLED=1"
  if [ -n "$dfs" ]; then echo "DATAFORSEO_API_KEY=$dfs"; fi
} > "$env_file"
if grep -q '^DATAFORSEO_API_KEY=' "$env_file"; then echo "DataForSEO: key present (live data, 2 USD/day ceiling)"; else echo "DataForSEO: no key (sample mode)"; fi
unset dfs old_secret
echo "app.env names: $(cut -d= -f1 "$env_file" | tr '\n' ' ')"
bash "$rel/install-timers.sh"  # P0-2: cron timers and CRON_TRIGGER_SECRET (kept across installs); needs the final app.env, runs before the service starts

# 5. Service with the hard memory cap.
sudo install -m 644 "$rel/lunar-optimize.service" /etc/systemd/system/lunar-optimize.service
sudo systemctl daemon-reload
sudo systemctl enable --now lunar-optimize
ok=0
for i in $(seq 1 60); do
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:3601/sign-in || true)"
  [ "$code" = 200 ] && { ok=1; break; }
  sleep 3
done
if [ "$ok" != 1 ]; then echo "STOP: service did not answer"; sudo journalctl -u lunar-optimize -n 40 --no-pager | sed -E 's/(SECRET|KEY)=[^ ]*/\1=<redacted>/g'; exit 1; fi
echo "service up on 127.0.0.1:3601"

# 6. nginx site (new file only), validate, reload, then a certificate for this one name.
sudo install -m 644 "$rel/optimize.projectlunar.ai.nginx" /etc/nginx/sites-enabled/optimize.projectlunar.ai
if ! sudo nginx -t; then sudo rm -f /etc/nginx/sites-enabled/optimize.projectlunar.ai; echo "STOP: nginx -t failed, site removed"; exit 1; fi
sudo systemctl reload nginx
sudo certbot --nginx -d optimize.projectlunar.ai --non-interactive --keep-until-expiring --redirect --cert-name optimize.projectlunar.ai
sudo nginx -t && sudo systemctl reload nginx

# 7. After-state.
echo "mission-control after: $(git -C /opt/mission-control rev-parse --short HEAD) $(cat /opt/mission-control/.next/BUILD_ID)"
if [ "$(git -C /opt/mission-control rev-parse --short HEAD)" = "$mc_head_before" ] && [ "$(cat /opt/mission-control/.next/BUILD_ID)" = "$mc_build_before" ]; then echo "mission-control unchanged"; else echo "STOP: mission-control HEAD/BUILD_ID changed during the run (another deploy?); Optimize is installed, check before trusting either"; exit 1; fi
for u in https://studio.projectlunar.ai/api/health https://mission-control.projectlunar.ai/ https://optimize.projectlunar.ai/sign-in; do echo "$u $(curl -s -o /dev/null -m 10 -w '%{http_code}' "$u")"; done
free -m | awk '/Mem/{print "memory available MB", $7, "of", $2}'
systemctl show lunar-optimize -p MemoryCurrent -p MemoryMax | tr '\n' ' '; echo
df -h / | tail -1
rm -f "$rel/lunar-optimize-pkg.tar.gz"
echo "DONE"
