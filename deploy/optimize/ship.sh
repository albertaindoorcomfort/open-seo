#!/usr/bin/env bash
# Operator-run (Git Bash on the laptop): ship the Lunar Optimize package to the Studio box and install it.
# Copies the already-paid DataForSEO key from the HVAC account straight into the box install over stdin;
# the value is never printed or written on the laptop. If that read fails, the app runs in sample mode.
set -euo pipefail
here=/c/Users/XanderGamelo/.LunarProjectPrime/.tmp/cf/lo-release
export AWS_CA_BUNDLE='C:\Users\XanderGamelo\.codex\visualizations\2026\09\22\01a0c69b-a5c8-74e2-8efb-c06cfb2577b0\windows-trusted-ca.pem'
key=C:/Users/XanderGamelo/.ssh/openclaw-deploy
push_key() { aws ec2-instance-connect send-ssh-public-key --profile lunar --region us-west-2 --instance-id i-0f90d81b0a911d4b9 --instance-os-user ubuntu --ssh-public-key file://C:/Users/XanderGamelo/.ssh/openclaw-deploy.pub --query Success --output text >/dev/null; }
push_key
ssh -i "$key" ubuntu@54.186.157.251 'rm -rf /tmp/lo-release && mkdir -p /tmp/lo-release'
push_key
scp -i "$key" "$here/lunar-optimize-pkg.tar.gz" "$here/pkg-sha" "$here/box-install.sh" "$here/run.sh" "$here/migrate.sh" \
  "$here/lunar-optimize.service" "$here/optimize.projectlunar.ai.nginx" ubuntu@54.186.157.251:/tmp/lo-release/
# P0-2 scheduler files, installed by install-timers.sh (called from box-install.sh).
push_key
scp -i "$key" "$here/install-timers.sh" "$here/cron-tick.sh" "$here/lunar-optimize-cron.service" "$here/lunar-optimize-cron.timer" \
  "$here/lunar-optimize-cron-daily.service" "$here/lunar-optimize-cron-daily.timer" ubuntu@54.186.157.251:/tmp/lo-release/
dfs_key() {
  aws secretsmanager get-secret-value --profile "${HVAC_PROFILE:-hvac-automations}" --region us-west-2 \
    --secret-id hvac-automations/openseo-env --query SecretString --output text 2>/dev/null \
  | python -c 'import json,sys
env=json.load(sys.stdin)["env"]
for line in env.splitlines():
    if line.startswith("DATAFORSEO_API_KEY="): sys.stdout.write(line.split("=",1)[1].strip())' 2>/dev/null || true
}
push_key
dfs_key | ssh -i "$key" ubuntu@54.186.157.251 'bash /tmp/lo-release/box-install.sh' 2>&1 | tee "$here/install.log"
