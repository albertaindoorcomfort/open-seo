# Lunar Optimize release kit

How Lunar Optimize ships to the Studio box, rolls back, and backs up and restores its data. The box owner runs these steps. Never print a value from `app.env` or `backup.env`: read names with `cut -d= -f1`.

## What is on the box

```
/opt/lunar-optimize/
  releases/<sha>/      one per install: REVISION, app/, node/, runtime/, bin/, kit/, smoke.log, PKG_SHA256
  current  -> releases/<sha>   the live release (the systemd unit runs from it)
  previous -> releases/<sha>   the release it replaced (rollback.sh goes back to it)
  data/                shared by every release, never moved (D1, KV, R2, Durable Objects)
  app.env              shared settings, mode 600, merged on install, never rewritten
  bin/                 rollback.sh, backup.sh, restore.sh, env-set.sh, lib.sh
  deploy-history.log   one line per install, rollback, backup, restore and env-set
```

The box keeps at most three releases: the new one, the one it replaced, and the one before that. Data is never rolled back. D1 migrations only move forward, so a rollback leaves newer migrations applied (rollback.sh names them). Never change the D1, KV or R2 ids in `wrangler.jsonc`: miniflare derives file names in `data/` from them.

## Ship a release (laptop, then box)

1. Archive the exact commit and write its sha to `source-sha` in the release folder.
2. WSL: `bash build.sh <archive.tar>`. It builds with the Node version pinned in `.nvmrc` (it stops if `package.json` `engines.node` differs) and packages the release with its own `bin/` and `kit/`.
3. WSL: `bash smoke.sh`. It saves `smoke.log` next to the package and ends with `SMOKE PASS`.
4. Git Bash: `bash ship.sh`. It refuses a package without a passing `smoke.log`, checks the package checksum on the box, then runs the package's own `kit/box-install.sh`.

`box-install.sh` stops on any pre-check (another deploy, Studio unhealthy, jobs in flight, under 1.5 GB free), takes a pre-deploy backup when the backup is configured, checks the bundled Node against `.nvmrc`, merges `app.env`, then stops the unit, points `current` at the new release, starts it and waits up to 180 s until that release serves. If it does not, the box goes back to the previous release by itself and the install fails. The nginx site file is installed only when it changed, with `nginx -t` and the old file put back on failure. certbot is not run: the certificate exists, and certbot collides with the box's own renew timer.

The first install in this layout moves the live 2026-10-21 install (`app/`, `node/`, `runtime/`) into `releases/<its sha>/`, so `previous` points at it and rollback can return to it.

## Settings (app.env)

An install keeps every name already in `app.env` with its value, keeps hand-added names, and adds only missing ones: the defaults in `box-install.sh`, the generated secrets in `env_generated` (created once, then kept), and `DATAFORSEO_API_KEY` from stdin when it is missing. To change a value, type it at the hidden prompt:

```
read -rs v && printf '%s' "$v" | bash /opt/lunar-optimize/bin/env-set.sh NAME; unset v
sudo systemctl restart lunar-optimize
```

## Roll back

```
bash /opt/lunar-optimize/bin/rollback.sh            # to the previous release
bash /opt/lunar-optimize/bin/rollback.sh <sha>      # to a named release on the box
```

It stops the unit, flips `current` (and `previous` to the release it left), starts it, and passes only when the unit's process runs from that release and `/sign-in` answers 200 within 60 seconds of the stop. Run it again to roll forward.

## Backup

Nightly at 09:30 UTC, `lunar-optimize-backup.timer` runs `bin/backup.sh` as root. It stops the unit for one tar of `data/`, starts it again, checks the archive and uploads it with its `.sha256` to S3. It keeps `LUNAR_OPTIMIZE_BACKUP_KEEP_DAYS` days and never fewer than the newest three archives. The archive holds `data/` only. `app.env` is not in it, and `BETTER_AUTH_SECRET` must be kept to read restored OAuth tokens and sessions, so store a copy of it in the Lunar secret store.

Why a short stop and not a live copy: miniflare keeps D1, KV, R2 and the Durable Objects in SQLite files with WAL, and KV and R2 blobs must match their SQLite indexes. A copy taken while workerd writes can catch a transaction halfway, and a per-file `sqlite3 .backup` would still not make the set agree. The box has no LVM or btrfs snapshot. The log line gives the seconds the service was down.

Set it up once:

1. Create the bucket (public access blocked, versioning on, noncurrent versions expiring after 30 days) and give the box's instance role `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` and `s3:DeleteObject` on that bucket and prefix. Install the aws cli if `aws --version` fails.
2. Write the settings file (root, mode 600):

   ```
   sudo install -d -m 750 /etc/lunar-optimize
   printf 'LUNAR_OPTIMIZE_BACKUP_BUCKET=%s\nLUNAR_OPTIMIZE_BACKUP_KEEP_DAYS=14\n' '<bucket>' | sudo tee /etc/lunar-optimize/backup.env >/dev/null
   sudo chmod 600 /etc/lunar-optimize/backup.env
   sudo systemctl enable --now lunar-optimize-backup.timer
   ```

   Optional names: `LUNAR_OPTIMIZE_BACKUP_PREFIX` (default `lunar-optimize/data`), `AWS_PROFILE`, `AWS_REGION`.

3. Take one now: `sudo systemctl start lunar-optimize-backup.service`, then `journalctl -u lunar-optimize-backup -n 20`.

The first release-layout install has no backup script on the box yet. Take a local copy by hand just before it (about the size of `data/` must be free):

```
sudo systemctl stop lunar-optimize && sudo tar -C /opt/lunar-optimize -czf /var/tmp/lo-data-before-release-layout.tar.gz data; sudo systemctl start lunar-optimize
```

## Restore

```
sudo bash /opt/lunar-optimize/bin/restore.sh --list
sudo bash /opt/lunar-optimize/bin/restore.sh latest --into /var/tmp/lo-restore-rehearsal     # rehearsal
sudo bash /opt/lunar-optimize/bin/restore.sh <archive name> --live                           # real restore
```

Both modes check the archive against its `.sha256`, refuse paths outside `data/` and links, unpack it, and run SQLite `quick_check` on every database with row counts for D1. The rehearsal touches nothing live. `--live` takes an exact archive name, unpacks and checks it beside `data/`, stops the unit, moves `data/` to `data.before-restore-<time>` (kept), puts the archive in its place and waits until the app serves. Delete the kept copy once the app checks out.

## Rehearsals to record

Record each output in `04_releases/` with the date.

1. Rollback: after an install, `bash /opt/lunar-optimize/bin/rollback.sh`, then `cat /opt/lunar-optimize/current/REVISION` and `curl -s -o /dev/null -w '%{http_code}' https://optimize.projectlunar.ai/sign-in`. Pass: the previous sha, served within 60 s, data intact (sign in, open a project). Roll forward with the same command.
2. Restore: `sudo bash /opt/lunar-optimize/bin/restore.sh latest --into /var/tmp/lo-restore-rehearsal`. Pass: `REHEARSAL OK` with `quick_check failed 0` and user and project counts that match the app. Then `sudo rm -rf /var/tmp/lo-restore-rehearsal`.

## Adding a sub-installer

`box-install.sh` step 9 calls each sub-installer with one line, after `app.env` is merged and the new release serves. A sub-installer sits in this folder, sources `lib.sh`, and installs its own units (`install-backup.sh` is the example). A secret the app needs is one more name in `env_generated`.
