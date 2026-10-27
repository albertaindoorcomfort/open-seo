# Docker Self-Hosting

Run OpenSEO locally with Docker.

In Docker mode, OpenSEO uses `AUTH_MODE=local_noauth` (no auth checks, local admin user `admin@localhost`). Only expose it behind your own auth-protected reverse proxy, tunnel, or private network.

The default `compose.yaml` uses the published GHCR image:

- `ghcr.io/every-app/open-seo:latest`

## Prerequisites

- Docker Desktop (or Docker Engine + Docker Compose)
- A DataForSEO API key (see [`DATAFORSEO_API_KEY.md`](./DATAFORSEO_API_KEY.md))

## Quickstart

```bash
cp .env.example .env
```

Set `DATAFORSEO_API_KEY` in `.env` using the [DataForSEO setup guide](./DATAFORSEO_API_KEY.md), then start OpenSEO:

```bash
docker compose up -d
```

Open `http://localhost:<PORT>` (default `3001`). The image already holds the built app, so a start only checks the env, applies database migrations and serves; it is ready within seconds. Follow progress with `docker compose logs -f`.

Optional env values:

- `PORT` (defaults to `3001`)
- `ALLOWED_HOST` (single reverse-proxy hostname to allow; other hostnames get a 403 "Blocked request" page)
- `AUTH_MODE=local_noauth` (already set in compose; also a build-time setting, see below)
- `OPEN_SEO_IMAGE` (defaults to `ghcr.io/every-app/open-seo:latest`)
- `OPENROUTER_API_KEY` (required for AI features such as SAM; see [OpenRouter](https://openrouter.ai/settings/keys))

If you are putting Docker behind a reverse proxy or a temporary tunnel, remember that Docker self-hosting runs with app auth disabled. Only expose it behind your own auth-protected reverse proxy, tunnel, or private network, and add the public hostname before restarting:

```bash
ALLOWED_HOST=yourdomain.com docker compose up -d
```

You can also persist it in `.env`.

## Telemetry

OpenSEO collects anonymized telemetry for core usage events: heartbeats with aggregate counts (installs, users, projects, feature usage) tied to a random install ID, sent every 5 minutes during the first two hours after install, then at most once daily. Telemetry also includes failed setup check names and statuses, never values or error messages. No URLs, keywords, prompts, emails, or IP-derived location are collected, and idle installs send nothing.

Heartbeats are triggered by requests to the app or MCP server. Requests to `/api/health`, including Docker's automatic health checks, do not trigger telemetry.

To disable it, set `OPENSEO_TELEMETRY_DISABLED=1` (or `DO_NOT_TRACK=1`) in `.env`, then run `docker compose up -d --force-recreate open-seo`.

## Pin to a specific image tag

Set `OPEN_SEO_IMAGE` in `.env` and restart:

```bash
OPEN_SEO_IMAGE=ghcr.io/every-app/open-seo:v1.2.3
docker compose up -d
```

## Build-time settings

The image builds the app once, when the image is built, and the build bakes these settings into it:

- every `VITE_*` value (for example `VITE_BRAND`, `VITE_BRAND_SUPPORT_EMAIL`, `VITE_SHOW_DEVTOOLS`)
- `AUTH_MODE`, `BYPASS_EMAIL_VERIFICATION`
- `POSTHOG_PUBLIC_KEY`, `POSTHOG_HOST`, `TURNSTILE_SITE_KEY`

Pass them to `docker build` as build args. `Dockerfile.selfhost` defaults to `AUTH_MODE=local_noauth` and `VITE_SHOW_DEVTOOLS=false`, the values `compose.yaml` sets, and the published image uses those defaults. An empty value counts as unset.

The container must run with the same values. If one differs, the container stops at start, before migrations, names each variable that differs (never its value) and prints the `docker build` command to rebuild with. Changing one of these settings therefore needs a rebuild, not a restart. Other env values (API keys, `ALLOWED_HOST`, `PORT`, telemetry) are read at start as before.

## Build your own image locally

If you are testing local code changes, build and run a local tag:

```bash
docker build -f Dockerfile.selfhost -t open-seo:local .
OPEN_SEO_IMAGE=open-seo:local docker compose up -d
```

With build-time settings, pass each one, with the same values the container gets:

```bash
docker build -f Dockerfile.selfhost \
  --build-arg VITE_BRAND="$VITE_BRAND" \
  --build-arg AUTH_MODE=local_noauth \
  --build-arg VITE_SHOW_DEVTOOLS=false \
  -t open-seo:local .
```

The build runs the app's production build, which the repo `.npmrc` allows a 4 GB heap; the running container never builds. To deploy to a small host, build on another machine and copy the image across (`docker save open-seo:local | ssh host docker load`).

## Image layout and data

`Dockerfile.selfhost` has three stages:

- `builder`: installs every dependency and runs the production build, on the build machine's platform.
- `runtime-deps`: a production-only install of the exact `wrangler` version the app uses, for the target platform. The build fails if it would install any package version the app's lockfile does not pin.
- `runtime`: `node:22-slim` with the built app, the D1 migrations and that `wrangler` install. No compiler, no dev dependencies and no source.

At start, `docker-entrypoint.sh` runs the env preflight, the build-time settings check and `wrangler d1 migrations apply`, then serves the built app with `wrangler dev` on `0.0.0.0:$PORT`. A small front worker comes first and applies the `ALLOWED_HOST` check and `X-Forwarded-Proto` before a request reaches the app.

All data (D1, KV, R2, Durable Objects, Workflows) stays in the `open_seo_data` volume at `/app/.wrangler`, in the same files that images which built the app at start used. Changing between those images and this one keeps your data in both directions, and migrations do nothing when the store is already current.

## Common commands

- Restart service after env changes:

```bash
docker compose up -d open-seo
```

- Pull latest published image and restart:

```bash
docker compose pull && docker compose up -d
```

- Stop:

```bash
docker compose down
```

## Health and troubleshooting

Startup checks appear in `docker compose logs` before migrations. Once running, `/api/health` reports configuration and database status, and `docker compose ps` reports container health. The image's health check probes `/api/health` with a 60 second start period. A deployment can probe `/health/ready` instead, which returns 503 until the database, KV and storage answer; with telemetry on, those probes count as activity, so the image does not use it by default.

If the container stops with `--- OpenSEO build-time env check ---`, rebuild the image with the build args it names, or set those variables back to the values the image was built with.

## Troubleshooting environment variables

To confirm Docker Compose is using the expected environment variables:

```bash
docker compose config
```

Check that `AUTH_MODE=local_noauth`, and that `DATAFORSEO_API_KEY` is the base64
encoded value of your DataForSEO email and API password in this format:
`email:password`.

If you changed `.env`, recreate the container so Compose reapplies it:

```bash
docker compose up -d --force-recreate open-seo
```
