# shellcheck shell=bash
# Shared by the Lunar Optimize box scripts: box-install, rollback, backup, restore, env-set and the
# sub-installers. Source it; it only sets variables and defines functions.
# Paths default to the Studio box. The LO_* overrides exist for the local test harness.

LO_ROOT="${LO_ROOT:-/opt/lunar-optimize}"
LO_UNIT="${LO_UNIT:-lunar-optimize}"
LO_USER="${LO_USER:-ubuntu}"
LO_PORT="${LO_PORT:-3601}"
# A path that answers 200 once the app serves. /health/ready is stronger once every kept release has it.
LO_PROBE_PATH="${LO_PROBE_PATH:-/sign-in}"
LO_SYSTEMD_DIR="${LO_SYSTEMD_DIR:-/etc/systemd/system}"
LO_ETC_DIR="${LO_ETC_DIR:-/etc/lunar-optimize}"
LO_ENV_FILE="${LO_ENV_FILE:-$LO_ROOT/app.env}"
LO_BACKUP_ENV="${LO_BACKUP_ENV:-$LO_ETC_DIR/backup.env}"
LO_HISTORY="$LO_ROOT/deploy-history.log"

lo_die() {
  echo "STOP: $*" >&2
  exit 1
}

# One operation at a time (install, rollback, backup, restore, env-set). Waits up to $1 seconds (default: no wait).
lo_lock() {
  local lock="$LO_ROOT/.ops.lock"
  [ -e "$lock" ] || : >"$lock"
  exec 9<"$lock"
  if [ "${1:-0}" -gt 0 ]; then
    flock -w "$1" 9 || lo_die "another Lunar Optimize operation still holds $lock after $1 s"
  else
    flock -n 9 || lo_die "another Lunar Optimize operation holds $lock"
  fi
}

lo_record() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LO_HISTORY"
  # backup.sh and restore.sh run as root; the file stays writable for the ubuntu scripts.
  if [ "$(id -u)" = 0 ]; then chown "$LO_USER:" "$LO_HISTORY" 2>/dev/null || true; fi
}

lo_valid_rev() {
  [[ $1 =~ ^[0-9a-f]{7,40}$ ]]
}

# The revision a link (current or previous) points at, or nothing.
lo_link_rev() {
  local target
  target="$(readlink "$LO_ROOT/$1" 2>/dev/null)" || return 0
  printf '%s\n' "${target#releases/}"
}

# Point a link (current or previous) at releases/<rev> with one rename, so it is never missing.
lo_set_link() {
  ln -sfn "releases/$2" "$LO_ROOT/.$1.next"
  mv -Tf "$LO_ROOT/.$1.next" "$LO_ROOT/$1"
}

# The D1 migration files a release carries, one per line.
lo_migrations() {
  find "$LO_ROOT/releases/$1/app/drizzle" -maxdepth 1 -name '*.sql' -printf '%f\n' 2>/dev/null | sort
}

# The unit's recent log. Values of *SECRET*, *KEY*, *TOKEN* and *PASSWORD* names and Bearer tokens are hidden.
lo_journal_tail() {
  { sudo journalctl -u "$LO_UNIT" -n "${1:-40}" --no-pager 2>&1 || true; } |
    sed -E 's/([A-Za-z0-9_]*(SECRET|KEY|TOKEN|PASSWORD)[A-Za-z0-9_]*)=[^ ]*/\1=<redacted>/g; s/(Bearer )[^ ]+/\1<redacted>/g'
}

# Wait up to $2 seconds until releases/$1 serves: the unit's main process runs from that release's app
# directory (run.sh changes into it by its physical path) and the app answers 200. With $1 empty, only
# the answer counts. Sets LO_WAITED to the seconds it took.
lo_wait_serving() {
  local want="" pid cwd code start=$SECONDS
  if [ -n "$1" ]; then want="$(cd "$LO_ROOT/releases/$1/app" && pwd -P)" || return 1; fi
  while [ $((SECONDS - start)) -lt "$2" ]; do
    pid="$(systemctl show -p MainPID --value "$LO_UNIT" 2>/dev/null || true)"
    if [ -n "$pid" ] && [ "$pid" != 0 ]; then
      cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || sudo -n readlink "/proc/$pid/cwd" 2>/dev/null || true)"
      if [ -z "$want" ] || [ "$cwd" = "$want" ]; then
        code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$LO_PORT$LO_PROBE_PATH" || true)"
        if [ "$code" = 200 ]; then
          LO_WAITED=$((SECONDS - start))
          [ "$LO_WAITED" -le "$2" ]
          return
        fi
      fi
    fi
    sleep 2
  done
  return 1
}

# Stop the unit, point current at releases/$1 (previous at what was current), start it, and wait up to
# $2 seconds from the stop until $1 serves. Sets LO_WAITED to the seconds from the stop.
lo_switch() {
  local from t0=$SECONDS
  from="$(lo_link_rev current)"
  LO_WAITED=0
  sudo systemctl stop "$LO_UNIT" || return 1
  if [ -n "$from" ] && [ "$from" != "$1" ]; then lo_set_link previous "$from"; fi
  lo_set_link current "$1"
  sudo systemctl start "$LO_UNIT" || true
  if lo_wait_serving "$1" $(($2 - (SECONDS - t0))); then
    LO_WAITED=$((SECONDS - t0))
    return 0
  fi
  LO_WAITED=$((SECONDS - t0))
  return 1
}

# app.env holds secrets. These functions print names only, never values, and leave the file at mode 600.
lo_env_has() {
  grep -Eq "^[[:space:]]*(export[[:space:]]+)?$2[[:space:]]*=" "$1" 2>/dev/null
}

lo_env_tmp() {
  mktemp "$(dirname "$1")/.app.env.XXXXXX"
}

# Rename a finished copy over the env file, with the file's owner (or the service user for a new file).
lo_env_commit() {
  if [ -e "$1" ]; then
    chown --reference="$1" "$2" 2>/dev/null || true
  elif [ "$(id -u)" = 0 ]; then
    chown "$LO_USER:" "$2"
  fi
  chmod 600 "$2"
  mv -f "$2" "$1"
}

# Add NAME=VALUE only when NAME is absent. An existing name is never changed or dropped.
lo_env_add_missing() {
  local file=$1 name=$2 value=$3 tmp
  if lo_env_has "$file" "$name"; then
    echo "app.env: kept $name"
    return 0
  fi
  tmp="$(lo_env_tmp "$file")"
  if [ -s "$file" ]; then
    cat "$file" >"$tmp"
    if [ -n "$(tail -c1 "$tmp")" ]; then echo >>"$tmp"; fi
  fi
  printf '%s=%s\n' "$name" "$value" >>"$tmp"
  lo_env_commit "$file" "$tmp"
  echo "app.env: added $name"
}

# Set NAME to VALUE: the first NAME line is replaced in place, later duplicates are dropped, every
# other line is kept as it is. Only env-set.sh uses this.
lo_env_set() {
  local file=$1 name=$2 value=$3 tmp line seen=0
  local re="^[[:space:]]*(export[[:space:]]+)?${name}[[:space:]]*="
  tmp="$(lo_env_tmp "$file")"
  if [ -e "$file" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      if [[ $line =~ $re ]]; then
        if [ "$seen" = 0 ]; then printf '%s=%s\n' "$name" "$value"; fi
        seen=1
      else
        printf '%s\n' "$line"
      fi
    done <"$file" >"$tmp"
  fi
  if [ "$seen" = 0 ]; then printf '%s=%s\n' "$name" "$value" >>"$tmp"; fi
  lo_env_commit "$file" "$tmp"
  if [ "$seen" = 1 ]; then echo "app.env: replaced $name"; else echo "app.env: added $name"; fi
}

# The names in an env file, one per line (never values, never comment lines).
lo_env_names() {
  sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=.*/\2/p' "$1"
}

# The last value of NAME in an env file read as data (never sourced), without surrounding quotes.
lo_env_get() {
  [ -r "$1" ] || return 0
  sed -nE "s/^[[:space:]]*(export[[:space:]]+)?$2[[:space:]]*=[[:space:]]*//p" "$1" | tail -1 |
    sed -E "s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/"
}

# A new random secret: 64 letters and digits.
lo_new_secret() {
  local s
  s="$(openssl rand -base64 96 | tr -dc 'A-Za-z0-9' | cut -c1-64)"
  [ "${#s}" -eq 64 ] || lo_die "could not generate a secret"
  printf '%s' "$s"
}

# Backup settings for backup.sh and restore.sh: from the environment, else from $LO_BACKUP_ENV.
# Sets LO_BUCKET, LO_PREFIX and LO_KEEP_DAYS, and exports the optional AWS_* names it finds.
lo_backup_settings() {
  local name value
  for name in LUNAR_OPTIMIZE_BACKUP_BUCKET LUNAR_OPTIMIZE_BACKUP_PREFIX LUNAR_OPTIMIZE_BACKUP_KEEP_DAYS \
    AWS_PROFILE AWS_REGION AWS_DEFAULT_REGION AWS_CONFIG_FILE AWS_SHARED_CREDENTIALS_FILE; do
    if [ -z "${!name:-}" ]; then
      value="$(lo_env_get "$LO_BACKUP_ENV" "$name")"
      if [ -n "$value" ]; then export "$name=$value"; fi
    fi
  done
  LO_BUCKET="${LUNAR_OPTIMIZE_BACKUP_BUCKET:-}"
  LO_PREFIX="${LUNAR_OPTIMIZE_BACKUP_PREFIX:-lunar-optimize/data}"
  LO_KEEP_DAYS="${LUNAR_OPTIMIZE_BACKUP_KEEP_DAYS:-14}"
  [[ $LO_BUCKET =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] ||
    lo_die "LUNAR_OPTIMIZE_BACKUP_BUCKET is not set to an S3 bucket name (in the environment or $LO_BACKUP_ENV)"
  [[ $LO_PREFIX =~ ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ ]] ||
    lo_die "LUNAR_OPTIMIZE_BACKUP_PREFIX must be a plain key prefix such as lunar-optimize/data"
  [[ $LO_KEEP_DAYS =~ ^[1-9][0-9]*$ ]] || lo_die "LUNAR_OPTIMIZE_BACKUP_KEEP_DAYS must be a whole number of days"
  command -v aws >/dev/null || lo_die "the aws cli is not installed"
}

# Archive names in the bucket, oldest first.
lo_backup_list() {
  local listing
  listing="$(aws s3api list-objects-v2 --bucket "$LO_BUCKET" --prefix "$LO_PREFIX/lunar-optimize-data-" \
    --query 'Contents[].Key' --output text)" || return 1
  printf '%s\n' "$listing" | tr '\t' '\n' |
    grep -oE 'lunar-optimize-data-[0-9]{8}T[0-9]{6}Z-[0-9a-z]+\.tar\.gz$' | sort || true
}

# Check a restored data dir: SQLite quick_check on every database, and row counts (never row data) in D1.
lo_verify_data() {
  local node="$LO_ROOT/current/node/bin/node"
  [ -x "$node" ] || node=node
  "$node" --no-warnings -e '
    const { DatabaseSync } = require("node:sqlite");
    const { readdirSync } = require("node:fs");
    const { join, sep } = require("node:path");
    const dir = process.argv[1];
    const files = readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".sqlite"));
    let failed = 0;
    for (const f of files) {
      const db = new DatabaseSync(join(dir, f), { readOnly: true });
      const rows = db.prepare("PRAGMA quick_check").all();
      if (!rows.every((r) => Object.values(r)[0] === "ok")) {
        failed++;
        console.log("quick_check FAILED " + f);
      }
      if (f.split(sep).includes("miniflare-D1DatabaseObject")) {
        const tables = new Set(db.prepare("select name from sqlite_master where type = ?").all("table").map((r) => r.name));
        const counts = ["d1_migrations", "user", "organization", "projects"]
          .filter((t) => tables.has(t))
          .map((t) => t + "=" + db.prepare("select count(*) as n from \"" + t + "\"").get().n);
        console.log("d1 " + f + ": " + counts.join(" "));
      }
      db.close();
    }
    console.log("sqlite files " + files.length + ", quick_check failed " + failed);
    process.exit(failed > 0 || files.length === 0 ? 1 : 0);
  ' "$1"
}
