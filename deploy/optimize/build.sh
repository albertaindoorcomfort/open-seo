#!/usr/bin/env bash
# Lunar Optimize release package for the Studio box. Builds the exact commit in WSL with
# AUTH_MODE=hosted baked into the client, then packages a release that needs nothing from the box:
# the Node version pinned in the commit's .nvmrc (official tarball, SHA-256 checked), the built worker
# (dist/), the D1 migrations, a standalone wrangler install that runs the worker locally (workerd) and
# applies migrations, the release's start scripts (bin/) and the box kit (kit/ = deploy/optimize).
# Usage (WSL): bash build.sh <archive.tar>   (the commit sha is in source-sha next to the output)
set -euo pipefail
src_tar="$1"
out="${LO_OUT_DIR:-/mnt/c/Users/XanderGamelo/.LunarProjectPrime/.tmp/cf/lo-release}"
work="${LO_WORK_DIR:-/var/tmp/lo-build}"
tool="${LO_TOOL_DIR:-/var/tmp/lo-toolchain}"
export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-/mnt/c/Users/XanderGamelo/.codex/visualizations/2026/09/22/01a0c69b-a5c8-74e2-8efb-c06cfb2577b0/windows-trusted-ca.pem}"
git_sha="$(tr -d ' \r\n' <"$out/source-sha")"
[[ $git_sha =~ ^[0-9a-f]{7,40}$ ]] || { echo "STOP: $out/source-sha does not hold a commit sha"; exit 1; }

# The exact commit first: its .nvmrc names the Node version, and package.json engines must agree.
rm -rf "$work"; mkdir -p "$work/src"; tar -xf "$src_tar" -C "$work/src"
node_version="$(tr -d ' \r\nv' <"$work/src/.nvmrc")"
[[ $node_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "STOP: .nvmrc must pin an exact version"; exit 1; }

# That Node, verified against the release's SHASUMS256.
node_dir="$tool/node-v$node_version"
mkdir -p "$tool"; cd "$tool"
if [ ! -x "$node_dir/bin/node" ]; then
  name="node-v$node_version-linux-x64.tar.xz"
  curl -fsSL --cacert "$NODE_EXTRA_CA_CERTS" -o "SHASUMS256-v$node_version.txt" "https://nodejs.org/dist/v$node_version/SHASUMS256.txt"
  curl -fsSL --cacert "$NODE_EXTRA_CA_CERTS" -o "$name" "https://nodejs.org/dist/v$node_version/$name"
  grep " $name\$" "SHASUMS256-v$node_version.txt" | sha256sum -c -
  rm -rf "$node_dir"; mkdir "$node_dir"; tar -xJf "$name" -C "$node_dir" --strip-components=1
fi
export PATH="$node_dir/bin:$PATH"
[ "$(node -v)" = "v$node_version" ] || { echo "STOP: $node_dir is not Node $node_version"; exit 1; }
engines="$(node -p 'require(process.argv[1]).engines?.node ?? ""' "$work/src/package.json")"
[ "$engines" = "$node_version" ] || { echo "STOP: package.json engines.node ($engines) differs from .nvmrc ($node_version)"; exit 1; }
corepack enable --install-directory "$node_dir/bin" >/dev/null 2>&1 || true
corepack prepare pnpm@10.30.1 --activate >/dev/null

# Build the exact commit.
cd "$work/src"
pnpm install --frozen-lockfile > "$out/install.log" 2>&1 || { tail -30 "$out/install.log"; exit 1; }
AUTH_MODE=hosted OPENSEO_TELEMETRY_DISABLED=1 pnpm run build > "$out/build.log" 2>&1 || { tail -40 "$out/build.log"; exit 1; }
test -s dist/server/index.js && test -s dist/server/wrangler.json
wrangler_version="$(node -p 'require("./node_modules/wrangler/package.json").version')"

# Release tree.
pkg="$work/pkg/lunar-optimize"; rm -rf "$work/pkg"; mkdir -p "$pkg/app" "$pkg/runtime" "$pkg/bin"
cp -a dist "$pkg/app/dist"
cp -a drizzle "$pkg/app/drizzle"
cp -a wrangler.jsonc "$pkg/app/wrangler.jsonc"
cp -a "$node_dir" "$pkg/node"
cp -a deploy/optimize "$pkg/kit"
install -m 755 deploy/optimize/run.sh deploy/optimize/migrate.sh "$pkg/bin/"
cp .nvmrc "$pkg/.nvmrc"
cd "$pkg/runtime"
printf '{"name":"lunar-optimize-runtime","private":true}\n' > package.json
"$pkg/node/bin/npm" install --no-audit --no-fund --omit=dev "wrangler@$wrangler_version" > "$out/runtime-install.log" 2>&1 || { tail -30 "$out/runtime-install.log"; exit 1; }
# Linux workerd must be present.
[ -d node_modules/@cloudflare/workerd-linux-64 ]
printf '%s\n' "$git_sha" > "$pkg/REVISION"
printf '%s\n' "$git_sha" > "$pkg/app/REVISION"
tar -czf "$out/lunar-optimize-pkg.tar.gz" -C "$work/pkg" lunar-optimize
sha256sum "$out/lunar-optimize-pkg.tar.gz" | cut -d' ' -f1 > "$out/pkg-sha"
rm -f "$out/smoke.log"
echo "== sizes"
du -sh "$pkg/app" "$pkg/node" "$pkg/runtime" "$pkg"
du -sh "$out/lunar-optimize-pkg.tar.gz"
echo "PASS package $(cut -c1-16 "$out/pkg-sha") rev $git_sha wrangler $wrangler_version node v$node_version"
