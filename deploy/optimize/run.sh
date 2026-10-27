#!/usr/bin/env bash
# Serve this release's built worker under local workerd on 127.0.0.1:3601 (nginx fronts it with TLS).
# Paths come from the release this file sits in (releases/<sha>/bin), resolved through the current link
# to the physical directory, so the running process shows which release it is. Data and settings are
# shared by every release.
set -euo pipefail
release="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
export PATH="$release/node/bin:$PATH"
cd "$release/app"
exec "$release/node/bin/node" "$release/runtime/node_modules/wrangler/bin/wrangler.js" dev \
  --config dist/server/wrangler.json --local --ip 127.0.0.1 --port "${LO_PORT:-3601}" \
  --persist-to "${LO_DATA_DIR:-/opt/lunar-optimize/data}" --env-file "${LO_ENV_FILE:-/opt/lunar-optimize/app.env}" \
  --show-interactive-dev-session=false --log-level warn
