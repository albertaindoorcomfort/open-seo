#!/usr/bin/env bash
# Apply this release's D1 (SQLite) migrations to the shared local store before every start.
# Migrations only move forward: a rollback to an older release leaves newer ones applied.
set -euo pipefail
release="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
export PATH="$release/node/bin:$PATH"
cd "$release/app"
# The built config resolves migrations_dir next to itself.
ln -sfn ../../drizzle dist/server/drizzle
exec "$release/node/bin/node" "$release/runtime/node_modules/wrangler/bin/wrangler.js" d1 migrations apply DB --local \
  --config dist/server/wrangler.json --persist-to "${LO_DATA_DIR:-/opt/lunar-optimize/data}"
