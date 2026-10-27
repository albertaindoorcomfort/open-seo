#!/usr/bin/env node
/**
 * Image-build steps for Dockerfile.selfhost. Each runs inside the image build:
 *
 *   runtime-package <dir>   Write <dir>/package.json naming only wrangler, at the
 *                           exact version the app installed, plus the app's
 *                           lockfile and pnpm settings, so the runtime stage's
 *                           production install resolves the same versions.
 *   check-runtime <dir>     Fail unless every package installed in
 *                           <dir>/node_modules is a name@version the app's
 *                           lockfile already pins.
 *   prepare                 After `pnpm run build`: bundle the container-start
 *                           scripts and the front worker into dist/selfhost/,
 *                           record the build-time env, point the built worker
 *                           config at the D1 migrations, and drop any
 *                           .dev.vars the build copied into dist.
 */
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function runtimePackage(dir) {
  const { version } = readJson(require.resolve("wrangler/package.json"));
  const { packageManager } = readJson("package.json");
  writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "open-seo-selfhost-runtime",
        private: true,
        packageManager,
        dependencies: { wrangler: version },
      },
      null,
      2,
    )}\n`,
  );
  copyFileSync("pnpm-lock.yaml", path.join(dir, "pnpm-lock.yaml"));
  copyFileSync("pnpm-workspace.yaml", path.join(dir, "pnpm-workspace.yaml"));
  console.log(`Runtime package: wrangler ${version}`);
}

function lockedVersions(lockfile) {
  const locked = new Set();
  for (const match of readFileSync(lockfile, "utf8").matchAll(
    /^ {2}'?(@?[^@\s'(]+)@([^:(\s']+)/gm,
  )) {
    locked.add(`${match[1]}@${match[2]}`);
  }
  return locked;
}

function installedPackages(dir, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (entry.startsWith("@")) {
      installedPackages(full, found);
      continue;
    }
    const manifest = path.join(full, "package.json");
    if (!existsSync(manifest)) continue;
    const { name, version } = readJson(manifest);
    if (name && version) found.push(`${name}@${version}`);
    installedPackages(path.join(full, "node_modules"), found);
  }
  return found;
}

function checkRuntime(dir) {
  const locked = lockedVersions(path.join(dir, "pnpm-lock.yaml"));
  const installed = installedPackages(path.join(dir, "node_modules"));
  const unlocked = installed.filter((id) => !locked.has(id));
  if (installed.length === 0 || unlocked.length > 0) {
    console.error(
      `Runtime install has ${installed.length} packages; not pinned by the app lockfile: ${unlocked.join(", ") || "(none installed)"}`,
    );
    process.exit(1);
  }
  console.log(
    `Runtime install: ${installed.length} packages, all pinned by the app lockfile.`,
  );
}

async function prepare() {
  // esbuild is not a direct dependency: use the exact copy wrangler pins.
  const esbuild = createRequire(require.resolve("wrangler"))("esbuild");
  const out = "dist/selfhost";
  rmSync(out, { recursive: true, force: true });

  // Container-start scripts, so the runtime needs no tsx or TypeScript.
  await esbuild.build({
    entryPoints: {
      preflight: "scripts/selfhost-preflight.ts",
      "build-env": "scripts/selfhost-build-env.ts",
    },
    outdir: out,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "warning",
  });

  const app = readJson("dist/server/wrangler.json");
  await esbuild.build({
    entryPoints: { index: "scripts/selfhost-front-worker.ts" },
    outdir: `${out}/front`,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "neutral",
    format: "esm",
    target: "es2022",
    logLevel: "warning",
  });
  writeFileSync(
    `${out}/front/wrangler.json`,
    `${JSON.stringify(
      {
        name: `${app.name}-selfhost-front`,
        main: "index.mjs",
        compatibility_date: app.compatibility_date,
        compatibility_flags: ["service_binding_extra_handlers"],
        no_bundle: true,
        services: [{ binding: "APP", service: app.name }],
      },
      null,
      2,
    )}\n`,
  );

  // The built config resolves migrations_dir ("drizzle") next to itself.
  const migrations = "dist/server/drizzle";
  rmSync(migrations, { recursive: true, force: true });
  symlinkSync("../../drizzle", migrations);

  // With CLOUDFLARE_INCLUDE_PROCESS_ENV or a local .dev.vars, the build copies
  // env into dist/*/.dev.vars, which would shadow the container's env and
  // could carry secrets into the image.
  for (const entry of readdirSync("dist", { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    rmSync(path.join("dist", entry.name, ".dev.vars"), { force: true });
  }

  const { buildEnvRecord } = await import(
    pathToFileURL(`${out}/build-env.mjs`).href
  );
  const record = buildEnvRecord(process.env);
  writeFileSync(
    "dist/.openseo-build-env",
    `${JSON.stringify(record, null, 2)}\n`,
  );
  console.log(
    `Recorded the build-time env: ${Object.keys(record).join(", ") || "none set"}.`,
  );
}

const [command, arg] = process.argv.slice(2);
if (command === "runtime-package" && arg) runtimePackage(arg);
else if (command === "check-runtime" && arg) checkRuntime(arg);
else if (command === "prepare") await prepare();
else {
  console.error(
    "Usage: selfhost-image.mjs runtime-package <dir> | check-runtime <dir> | prepare",
  );
  process.exit(2);
}
