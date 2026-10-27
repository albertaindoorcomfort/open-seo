/**
 * The build-time env check for the Docker self-host image.
 *
 * vite inlines every env var whose name starts with one of
 * BUILD_ENV_PREFIXES into the client and server bundles (vite.config.ts
 * imports the list from here). The image builds once, in its builder stage,
 * so a container whose env differs from the build would serve a bundle that
 * disagrees with its own server. The builder writes a record of the build env
 * (scripts/selfhost-image.mjs prepare); the entrypoint compares the container
 * env against it and refuses to start on a mismatch, naming the variables
 * (never their values) and the rebuild:
 *
 *   node dist/selfhost/build-env.mjs check dist/.openseo-build-env
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const BUILD_ENV_PREFIXES = [
  "VITE_",
  "AUTH_MODE",
  "BYPASS_EMAIL_VERIFICATION",
  "POSTHOG_PUBLIC_KEY",
  "POSTHOG_HOST",
  "TURNSTILE_SITE_KEY",
];

type Env = Record<string, string | undefined>;

/** Variable name to a SHA-256 of its value, for each build-relevant variable. */
type BuildEnvRecord = Record<string, string>;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

// An empty value counts as unset: the app reads both the same way, compose
// passes `NAME=${NAME:-}` as an empty string, and so does `--build-arg NAME=`.
export function buildEnvRecord(env: Env): BuildEnvRecord {
  const record: BuildEnvRecord = {};
  const names = Object.keys(env)
    .filter((name) =>
      BUILD_ENV_PREFIXES.some((prefix) => name.startsWith(prefix)),
    )
    .sort();
  for (const name of names) {
    const value = env[name];
    if (value) record[name] = sha256(value);
  }
  return record;
}

/** One line per differing variable. Names only: values never appear. */
export function diffBuildEnv(built: BuildEnvRecord, current: BuildEnvRecord) {
  const names = [...new Set([...Object.keys(built), ...Object.keys(current)])];
  const problems: { name: string; line: string }[] = [];
  for (const name of names.sort()) {
    if (built[name] === current[name]) continue;
    const line = !built[name]
      ? "set here, but the image was built without it"
      : !current[name]
        ? "the image was built with it, but it is unset or empty here"
        : "differs from the value the image was built with";
    problems.push({ name, line });
  }
  return problems;
}

export function mismatchMessage(problems: { name: string; line: string }[]) {
  const buildArgs = problems
    .map(({ name }) => `--build-arg ${name}="$${name}"`)
    .join(" ");
  return [
    "--- OpenSEO build-time env check ---",
    "This image was built with different build-time settings than this container has.",
    "They are baked into the app when the image is built, so they cannot change at start:",
    ...problems.map(({ name, line }) => `  - ${name}: ${line}`),
    "Fix: rebuild the image with this container's values as build args, for example",
    `  docker build -f Dockerfile.selfhost ${buildArgs} -t <image> .`,
    "(a name Dockerfile.selfhost does not declare needs an ARG line there first),",
    "or set these back to the values the image was built with.",
  ].join("\n");
}

function readRecord(file: string): BuildEnvRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record: BuildEnvRecord = {};
    for (const [name, hash] of Object.entries(parsed)) {
      if (typeof hash === "string") record[name] = hash;
    }
    return record;
  } catch {
    return null;
  }
}

function check(command: string | undefined, file: string | undefined) {
  if (command !== "check" || !file) {
    console.error("Usage: build-env.mjs check <record file>");
    return 2;
  }
  const built = readRecord(file);
  if (!built) {
    console.error(
      `--- OpenSEO build-time env check ---\nThe image has no readable build-time env record (${file}). Rebuild it with Dockerfile.selfhost.`,
    );
    return 1;
  }
  const problems = diffBuildEnv(built, buildEnvRecord(process.env));
  if (problems.length > 0) {
    console.error(mismatchMessage(problems));
    return 1;
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = check(process.argv[2], process.argv[3]);
}
