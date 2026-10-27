#!/usr/bin/env bash
# Slice P0-1: install the hardened optimize.projectlunar.ai nginx site on the Studio box.
# Backs up the live file, nginx -t, reload, checks /sign-in; restores the backup on any failure.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tr -d '\r' < "$here/optimize.projectlunar.ai.nginx" | bash "${BOX_SH:-$here/../box.sh}" '
set -e
ts=$(date -u +%Y%m%dT%H%M%SZ)
live=/etc/nginx/sites-enabled/optimize.projectlunar.ai
flock -n /tmp/mc-deploy.lock true || { echo "STOP: Studio deploy lock held"; exit 1; }
sudo mkdir -p /etc/nginx/backup-lunar-optimize
bk=/etc/nginx/backup-lunar-optimize/optimize.projectlunar.ai.$ts
sudo cp -p "$live" "$bk"; echo "backup $bk"
sudo tee "$live" >/dev/null
if ! sudo nginx -t; then sudo cp -p "$bk" "$live"; echo "nginx -t failed, restored"; exit 1; fi
sudo systemctl reload nginx; sleep 2
c=$(curl -s -o /dev/null -w "%{http_code}" --resolve optimize.projectlunar.ai:443:127.0.0.1 https://optimize.projectlunar.ai/sign-in)
echo "sign-in after reload $c"
if [ "$c" != 200 ]; then sudo cp -p "$bk" "$live"; sudo nginx -t && sudo systemctl reload nginx; echo "ROLLED BACK"; exit 1; fi
'
curl -sI https://optimize.projectlunar.ai/sign-in | grep -iE "^HTTP|strict-transport|x-frame|x-content-type|referrer-policy"
curl -s https://optimize.projectlunar.ai/.well-known/oauth-authorization-server | head -c 120; echo
curl -s -o /dev/null -w "studio %{http_code}\n" https://studio.projectlunar.ai/
