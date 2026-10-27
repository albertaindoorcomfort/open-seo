#!/usr/bin/env bash
# Operator-run (Git Bash on the laptop): ship the Lunar Optimize package to the Studio box and install it.
# Ships the package, its checksum and its passing smoke.log. On the box the checksum is verified before
# anything in the package runs; then the package's own kit/box-install.sh installs it as a release.
# Copies the already-paid DataForSEO key from the HVAC account straight into the box install over stdin;
# the value is never printed or written on the laptop, and the box uses it only when app.env has none.
set -euo pipefail
here="${LO_OUT_DIR:-/c/Users/XanderGamelo/.LunarProjectPrime/.tmp/cf/lo-release}"
export AWS_CA_BUNDLE='C:\Users\XanderGamelo\.codex\visualizations\2026\09\22\01a0c69b-a5c8-74e2-8efb-c06cfb2577b0\windows-trusted-ca.pem'
key=C:/Users/XanderGamelo/.ssh/openclaw-deploy
if ! grep -qx 'SMOKE PASS' "$here/smoke.log" 2>/dev/null || ! grep -q "^smoke pkg $(cat "$here/pkg-sha") " "$here/smoke.log"; then
  echo "STOP: no passing smoke.log for this package; run smoke.sh first"; exit 1
fi
push_key() { aws ec2-instance-connect send-ssh-public-key --profile lunar --region us-west-2 --instance-id i-0f90d81b0a911d4b9 --instance-os-user ubuntu --ssh-public-key file://C:/Users/XanderGamelo/.ssh/openclaw-deploy.pub --query Success --output text >/dev/null; }
push_key
ssh -i "$key" ubuntu@54.186.157.251 'rm -rf /tmp/lo-release && mkdir -p /tmp/lo-release'
push_key
scp -i "$key" "$here/lunar-optimize-pkg.tar.gz" "$here/pkg-sha" "$here/smoke.log" ubuntu@54.186.157.251:/tmp/lo-release/
dfs_key() {
  aws secretsmanager get-secret-value --profile "${HVAC_PROFILE:-hvac-automations}" --region us-west-2 \
    --secret-id hvac-automations/openseo-env --query SecretString --output text 2>/dev/null \
  | python -c 'import json,sys
env=json.load(sys.stdin)["env"]
for line in env.splitlines():
    if line.startswith("DATAFORSEO_API_KEY="): sys.stdout.write(line.split("=",1)[1].strip())' 2>/dev/null || true
}
push_key
dfs_key | ssh -i "$key" ubuntu@54.186.157.251 'cd /tmp/lo-release && sed "s/$/  lunar-optimize-pkg.tar.gz/" pkg-sha | sha256sum -c --quiet - && tar -xzf lunar-optimize-pkg.tar.gz lunar-optimize/kit && bash lunar-optimize/kit/box-install.sh' 2>&1 | tee "$here/install.log"
