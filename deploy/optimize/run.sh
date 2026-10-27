#!/usr/bin/env bash
# Serve the built worker under local workerd on 127.0.0.1:3601 (nginx fronts it with TLS).
set -euo pipefail
cd /opt/lunar-optimize/app
exec node /opt/lunar-optimize/runtime/node_modules/wrangler/bin/wrangler.js dev \
  --config dist/server/wrangler.json --local --ip 127.0.0.1 --port 3601 \
  --persist-to /opt/lunar-optimize/data --env-file /opt/lunar-optimize/app.env \
  --show-interactive-dev-session=false --log-level warn
