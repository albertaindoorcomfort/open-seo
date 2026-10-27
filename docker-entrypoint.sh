#!/bin/sh
# Self-host container entrypoint. The image already holds the built app (see
# Dockerfile.selfhost), so a start only checks the env, applies migrations and
# serves the built workers with wrangler dev. Nothing is built here.
#
# State (D1, KV, R2, Durable Objects, Workflows) persists under
# .wrangler/state, the open_seo_data volume: the same files the old
# start-time-build image wrote through vite preview, so both images share it.
set -e
cd "$(dirname "$0")"

echo 'OpenSEO sends an anonymous usage heartbeat (counts only). Disable: OPENSEO_TELEMETRY_DISABLED=1. Details: docs/SELF_HOSTING_DOCKER.md#telemetry'

# vite inlined the build-time env (VITE_*, AUTH_MODE, ...) into the bundle when
# the image was built. A container with different values would serve a bundle
# that disagrees with its server, so stop and name the build args instead.
node dist/selfhost/build-env.mjs check dist/.openseo-build-env

# The preflight validates the runtime env, so misconfiguration fails in seconds
# with the exact fix.
node dist/selfhost/preflight.mjs

WRANGLER="node --no-warnings --experimental-vm-modules node_modules/wrangler/wrangler-dist/cli.js"
STATE="$PWD/.wrangler/state"

# The built config's migrations_dir resolves to dist/server/drizzle, a link to
# ./drizzle. A no-op when the store is already migrated.
$WRANGLER d1 migrations apply DB --local --config dist/server/wrangler.json --persist-to "$STATE"

# The front worker is first, so it receives every request: it applies the Host
# allowlist and X-Forwarded-Proto the way vite preview did, then hands the
# request to the app (scripts/selfhost-front-worker.ts). The site-audit
# worker runs beside the app, as it did under vite preview.
exec $WRANGLER dev \
  --config dist/selfhost/front/wrangler.json \
  --config dist/server/wrangler.json \
  --config dist/open_seo_audit/wrangler.json \
  --local --ip 0.0.0.0 --port "${PORT:-3001}" \
  --persist-to "$STATE" \
  --show-interactive-dev-session=false
