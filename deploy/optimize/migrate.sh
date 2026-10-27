#!/usr/bin/env bash
# Apply the D1 (SQLite) migrations to the local store before every start.
set -euo pipefail
cd /opt/lunar-optimize/app
# The built config resolves migrations_dir next to itself.
ln -sfn ../../drizzle dist/server/drizzle
exec node /opt/lunar-optimize/runtime/node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local \
  --config dist/server/wrangler.json --persist-to /opt/lunar-optimize/data
