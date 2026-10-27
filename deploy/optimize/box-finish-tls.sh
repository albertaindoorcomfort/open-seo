#!/usr/bin/env bash
# Finish step after box-install.sh stopped at certbot ("Another instance of Certbot is already running").
# Gets the certificate for optimize.projectlunar.ai only, reloads nginx, prints the after-state.
set -euo pipefail
mc_head="$(git -C /opt/mission-control rev-parse --short HEAD)"; mc_build="$(cat /opt/mission-control/.next/BUILD_ID)"
echo "mission-control before: $mc_head $mc_build"
for i in $(seq 1 30); do pgrep -x certbot >/dev/null || pgrep -f "bin/certbot" >/dev/null || break; echo "waiting for another certbot"; sleep 10; done
sudo certbot --nginx -d optimize.projectlunar.ai --non-interactive --keep-until-expiring --redirect --cert-name optimize.projectlunar.ai
sudo nginx -t && sudo systemctl reload nginx
echo "mission-control after: $(git -C /opt/mission-control rev-parse --short HEAD) $(cat /opt/mission-control/.next/BUILD_ID)"
if [ "$(git -C /opt/mission-control rev-parse --short HEAD)" = "$mc_head" ] && [ "$(cat /opt/mission-control/.next/BUILD_ID)" = "$mc_build" ]; then echo "mission-control unchanged"; else echo "STOP: mission-control changed during the run"; exit 1; fi
for u in https://studio.projectlunar.ai/api/health https://mission-control.projectlunar.ai/ https://optimize.projectlunar.ai/sign-in; do echo "$u $(curl -s -o /dev/null -m 10 -w '%{http_code}' "$u")"; done
free -m | awk '/Mem/{print "memory available MB", $7, "of", $2}'
systemctl show lunar-optimize -p MemoryCurrent -p MemoryMax | tr '\n' ' '; echo
df -h / | tail -1
rm -f /tmp/lo-release/lunar-optimize-pkg.tar.gz
echo "DONE"
