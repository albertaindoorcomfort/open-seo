#!/usr/bin/env bash
# P0-2 scheduler for Lunar Optimize on the Studio box. wrangler dev never fires the worker's crons, so two
# systemd timers POST each cron expression to the app's loopback trigger (POST /internal/cron, Bearer secret):
#   lunar-optimize-cron.timer        every 5 minutes   "*/5 * * * *"   rank checks, stale-audit watchdog
#   lunar-optimize-cron-daily.timer  03:17 UTC daily   "17 3 * * *"    OAuth KV purge
# Run by box-install.sh as ubuntu (sudo for /etc), after app.env is written and before the service (re)starts.
# CRON_TRIGGER_SECRET is generated once and then kept: app.env wins, then /etc/lunar-optimize/cron.env (which
# survives an app.env rewrite), else a new one. It is added to app.env only when missing, never overwritten,
# and mirrored to cron.env (root, mode 600) for the timers. Safe to re-run. Prints names, never values.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dst="${LUNAR_OPTIMIZE_ROOT:-/opt/lunar-optimize}"
etc_dir="${LUNAR_OPTIMIZE_ETC:-/etc/lunar-optimize}"
unit_dir="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
app_env="$dst/app.env"
cron_env="$etc_dir/cron.env"
name=CRON_TRIGGER_SECRET
timers=(lunar-optimize-cron.timer lunar-optimize-cron-daily.timer)

# The last value of $name in a file (the one the dotenv loader keeps), or nothing.
value_in() { if sudo test -f "$1"; then sudo sed -n "s/^$name=//p" "$1" | tail -n 1; fi; }

[ -f "$app_env" ] || { echo "STOP: $app_env is missing (box-install.sh writes it first)"; exit 1; }

if grep -q "^$name=" "$app_env"; then
  secret="$(value_in "$app_env")"; from=app.env
else
  secret="$(value_in "$cron_env")"; from=cron.env
  if [ -z "$secret" ]; then secret="$(openssl rand -hex 32)"; from=generated; fi
fi
if [ "${#secret}" -lt 32 ]; then echo "STOP: $name in $from is under 32 characters; the app would ignore it. Set a longer one by hand."; exit 1; fi
echo "$name: from $from"

app_env_changed=0
if [ "$from" != app.env ]; then
  if [ -s "$app_env" ] && [ -n "$(tail -c 1 "$app_env")" ]; then echo >> "$app_env"; fi
  printf '%s=%s\n' "$name" "$secret" >> "$app_env"
  app_env_changed=1
  echo "app.env: $name added"
fi
chmod 600 "$app_env"

sudo install -d -m 700 -o root -g root "$etc_dir"
if [ "$(value_in "$cron_env")" != "$secret" ]; then
  sudo install -m 600 -o root -g root /dev/null "$cron_env"
  printf '%s=%s\n' "$name" "$secret" | sudo tee "$cron_env" >/dev/null
  echo "cron.env: $name written"
fi
unset secret

mkdir -p "$dst/bin"
install -m 755 "$here/cron-tick.sh" "$dst/bin/cron-tick.sh"
for unit in lunar-optimize-cron.service lunar-optimize-cron.timer lunar-optimize-cron-daily.service lunar-optimize-cron-daily.timer; do
  sudo install -m 644 "$here/$unit" "$unit_dir/$unit"
done
sudo systemctl daemon-reload
sudo systemctl enable "${timers[@]}"
sudo systemctl restart "${timers[@]}"

# A running app only reads app.env at start.
if [ "$app_env_changed" = 1 ]; then
  sudo systemctl try-restart lunar-optimize
  echo "lunar-optimize restarted if it was running, to load $name"
fi
systemctl list-timers --all --no-pager "${timers[@]}"
