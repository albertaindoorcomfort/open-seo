#!/usr/bin/env bash
# Lunar Optimize memory fix (2026-10-21): MemoryHigh=512M sat below the real ~530 MB working set with no swap,
# so the kernel throttled the service to a stall (memory.pressure full ~98%). Raise the soft limit to 800M and the
# hard cap to 900M via a drop-in, restart only lunar-optimize, then check it answers. Touches nothing else.
set -euo pipefail
avail=$(free -m | awk '/Mem/{print $7}')
echo "memory available before: ${avail} MB"
if [ "$avail" -lt 1000 ]; then echo "STOP: under 1000 MB available, not raising the cap"; exit 1; fi
sudo mkdir -p /etc/systemd/system/lunar-optimize.service.d
printf '[Service]\nMemoryHigh=800M\nMemoryMax=900M\n' | sudo tee /etc/systemd/system/lunar-optimize.service.d/memory.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl restart lunar-optimize
ok=0
for i in $(seq 1 60); do
  c="$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:3601/sign-in || true)"
  [ "$c" = 200 ] && { ok=1; break; }
  sleep 3
done
[ "$ok" = 1 ] || { echo "STOP: service did not answer after restart"; exit 1; }
for p in / /sign-in; do curl -s -o /dev/null -m 30 -w "local $p %{http_code} %{time_total}s\n" "http://127.0.0.1:3601$p"; done
systemctl show lunar-optimize -p MemoryCurrent -p MemoryHigh -p MemoryMax | tr '\n' ' '; echo
head -2 /sys/fs/cgroup/system.slice/lunar-optimize.service/memory.pressure
free -m | awk '/Mem/{print "memory available after MB", $7}'
curl -s -o /dev/null -m 10 -w "studio health %{http_code}\n" http://127.0.0.1:3000/api/health
echo "DONE"
