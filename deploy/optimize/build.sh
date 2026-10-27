#!/usr/bin/env bash
# Lunar Optimize release package for the Studio box (2026-10-21). Builds the exact commit in WSL with
# AUTH_MODE=hosted baked into the client, then packages a runtime that needs nothing from the box:
# Node 22 (official tarball, SHA-256 checked), the built worker (dist/), the D1 migrations, and a
# standalone wrangler install that runs the worker locally (workerd) and applies migrations.
# Usage (WSL): bash build.sh <archive.tar>
set -euo pipefail
src_tar="$1"
out=/mnt/c/Users/XanderGamelo/.LunarProjectPrime/.tmp/cf/lo-release
work=/var/tmp/lo-build-20261021
tool=/var/tmp/lo-toolchain-20261021
export NODE_EXTRA_CA_CERTS=/mnt/c/Users/XanderGamelo/.codex/visualizations/2026/09/22/01a0c69b-a5c8-74e2-8efb-c06cfb2577b0/windows-trusted-ca.pem

# Node 22, verified against the release's SHASUMS256.
mkdir -p "$tool"; cd "$tool"
if [ ! -x node22/bin/node ]; then
  curl -fsSL --cacert "$NODE_EXTRA_CA_CERTS" -o SHASUMS256.txt https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt
  name="$(grep -oE 'node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz' SHASUMS256.txt | head -1)"
  curl -fsSL --cacert "$NODE_EXTRA_CA_CERTS" -o "$name" "https://nodejs.org/dist/latest-v22.x/$name"
  grep " $name\$" SHASUMS256.txt | sha256sum -c -
  rm -rf node22; mkdir node22; tar -xJf "$name" -C node22 --strip-components=1
  echo "$name" > node22.name
fi
export PATH="$tool/node22/bin:$PATH"
node -v
corepack enable --install-directory "$tool/node22/bin" >/dev/null 2>&1 || true
corepack prepare pnpm@10.30.1 --activate >/dev/null

# Build the exact commit.
rm -rf "$work"; mkdir -p "$work/src"; tar -xf "$src_tar" -C "$work/src"
cd "$work/src"
pnpm install --frozen-lockfile > "$out/install.log" 2>&1 || { tail -30 "$out/install.log"; exit 1; }
AUTH_MODE=hosted OPENSEO_TELEMETRY_DISABLED=1 pnpm run build > "$out/build.log" 2>&1 || { tail -40 "$out/build.log"; exit 1; }
test -s dist/server/index.js && test -s dist/server/wrangler.json
wrangler_version="$(node -p 'require("./node_modules/wrangler/package.json").version')"

# Runtime tree.
pkg="$work/pkg/lunar-optimize"; rm -rf "$work/pkg"; mkdir -p "$pkg/app" "$pkg/runtime"
cp -a dist "$pkg/app/dist"
cp -a drizzle "$pkg/app/drizzle"
cp -a wrangler.jsonc "$pkg/app/wrangler.jsonc"
cp -a "$tool/node22" "$pkg/node"
cd "$pkg/runtime"
printf '{"name":"lunar-optimize-runtime","private":true}\n' > package.json
"$pkg/node/bin/npm" install --no-audit --no-fund --omit=dev "wrangler@$wrangler_version" > "$out/runtime-install.log" 2>&1 || { tail -30 "$out/runtime-install.log"; exit 1; }
# Linux workerd must be present.
ls node_modules/@cloudflare/ | grep -q workerd-linux-64
cd "$work/src"
git_sha="$(cat "$out/source-sha")"
printf '%s\n' "$git_sha" > "$pkg/app/REVISION"
tar -czf "$out/lunar-optimize-pkg.tar.gz" -C "$work/pkg" lunar-optimize
sha256sum "$out/lunar-optimize-pkg.tar.gz" | cut -d' ' -f1 > "$out/pkg-sha"
echo "== sizes"
du -sh "$pkg/app" "$pkg/node" "$pkg/runtime" "$pkg"
du -sh "$out/lunar-optimize-pkg.tar.gz"
echo "PASS package $(cut -c1-16 "$out/pkg-sha") rev $git_sha wrangler $wrangler_version node $(cat "$tool/node22.name")"
