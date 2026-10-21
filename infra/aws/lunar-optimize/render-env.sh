#!/bin/bash
# Write the app environment file from the Secrets Manager secret (a JSON object, one key per variable), plus the
# fixed production settings below. Mode 600, owned by root; nothing is printed except the variable NAMES written.
set -euo pipefail
out="${1:?usage: render-env.sh <output file>}"
: "${LO_DOMAIN:?}" "${LO_SECRET:?}" "${LO_REGION:?}"
umask 077
tmp="$(mktemp)"
aws secretsmanager get-secret-value --region "$LO_REGION" --secret-id "$LO_SECRET" --query SecretString --output text \
  | python3 -c 'import json,sys
for k, v in json.load(sys.stdin).items():
    if not k.replace("_", "").isalnum() or "\n" in str(v): raise SystemExit("refusing malformed key " + k)
    print(f"{k}={v}")' > "$tmp"
{
  # Fixed production settings (not secrets).
  echo "AUTH_MODE=hosted"
  echo "BETTER_AUTH_URL=https://$LO_DOMAIN"
  echo "ALLOWED_HOST=$LO_DOMAIN"
  echo "PORT=3001"
  echo "OPENSEO_TELEMETRY_DISABLED=1"
  echo "CLOUDFLARE_INCLUDE_PROCESS_ENV=true"
  # Checkout stays off until the Autumn catalog and price are verified (src/server/billing/lunar-checkout-gate.ts).
  echo "LUNAR_OPTIMIZE_CHECKOUT_ENABLED=false"
} >> "$tmp"
mv "$tmp" "$out"
chmod 600 "$out"
echo "wrote $(cut -d= -f1 "$out" | sort | tr '\n' ' ')"
