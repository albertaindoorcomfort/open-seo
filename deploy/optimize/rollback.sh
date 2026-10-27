#!/usr/bin/env bash
# Lunar Optimize rollback on the Studio box (run on the box as ubuntu). Leaves /opt/lunar-optimize/data in place.
set -euo pipefail
sudo systemctl disable --now lunar-optimize || true
sudo rm -f /etc/systemd/system/lunar-optimize.service
sudo systemctl daemon-reload
sudo rm -f /etc/nginx/sites-enabled/optimize.projectlunar.ai
sudo nginx -t && sudo systemctl reload nginx
echo "rolled back; certificate kept (sudo certbot delete --cert-name optimize.projectlunar.ai to remove)"
