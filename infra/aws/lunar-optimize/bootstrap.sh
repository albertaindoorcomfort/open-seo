#!/bin/bash
# Lunar Optimize host bootstrap (runs once from EC2 user data, and again by hand to update).
# Builds this checkout's image, writes the app environment from Secrets Manager (values never echoed), and starts
# Caddy + open-seo with Docker Compose. Requires LO_DOMAIN, LO_SECRET and LO_REGION.
set -euo pipefail
: "${LO_DOMAIN:?}" "${LO_SECRET:?}" "${LO_REGION:?}"
root=/opt/lunar-optimize
src=$root/src
cd "$src"

# Swap keeps the container's start-time vite build from running out of memory on a t3.small.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

docker build -f Dockerfile.selfhost -t lunar-optimize:current .

LO_DOMAIN="$LO_DOMAIN" LO_SECRET="$LO_SECRET" LO_REGION="$LO_REGION" bash infra/aws/lunar-optimize/render-env.sh "$root/app.env"

export LO_DOMAIN
docker compose -f infra/aws/lunar-optimize/compose.yaml --project-directory "$root" up -d
echo "Lunar Optimize started for https://$LO_DOMAIN"
