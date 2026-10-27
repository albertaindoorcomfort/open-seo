#!/usr/bin/env bash
# Sub-installer (box-install.sh calls it): the nightly backup service and timer. The timer is enabled
# only once /etc/lunar-optimize/backup.env exists (README: Backup); until then it is installed and idle.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
for unit in lunar-optimize-backup.service lunar-optimize-backup.timer; do
  sudo install -m 644 "$here/$unit" "$LO_SYSTEMD_DIR/$unit"
done
sudo systemctl daemon-reload
if sudo test -s "$LO_BACKUP_ENV"; then
  sudo systemctl enable --now lunar-optimize-backup.timer
  echo "backup timer enabled (nightly 09:30 UTC)"
else
  echo "backup timer installed but not enabled: write $LO_BACKUP_ENV (README: Backup), then"
  echo "  sudo systemctl enable --now lunar-optimize-backup.timer"
fi
