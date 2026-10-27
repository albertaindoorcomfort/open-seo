#!/usr/bin/env bash
# Set one key in /opt/lunar-optimize/app.env from stdin, without printing it. box-install.sh never
# changes a key that is already there, so this is how a value is rotated. Run on the box as ubuntu.
# Usage: env-set.sh NAME < file-with-the-value     (then: sudo systemctl restart lunar-optimize)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
name="${1:-}"
[[ $name =~ ^[A-Z][A-Z0-9_]*$ ]] || lo_die "usage: env-set.sh NAME < file-with-the-value"
[ ! -t 0 ] || lo_die "give the value on stdin, never on the command line"
value="$(cat)"
value="${value%$'\r'}"
[ -n "$value" ] || lo_die "the value on stdin is empty"
[[ $value != *$'\n'* ]] || lo_die "the value on stdin has more than one line"
lo_lock 0
lo_env_set "$LO_ENV_FILE" "$name" "$value"
lo_record "env-set $name"
echo "restart to apply: sudo systemctl restart $LO_UNIT"
