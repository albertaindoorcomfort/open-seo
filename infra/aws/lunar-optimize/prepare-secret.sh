#!/bin/bash
# Create or update the lunar-optimize/app secret in the lunar account. Never prints a value.
#  - BETTER_AUTH_SECRET: generated here once (kept if the secret already has one).
#  - DATAFORSEO_API_KEY: copied from the HVAC account's hvac-automations/openseo-env (the key OpenSEO already uses),
#    because an instance role in the lunar account cannot read another account's secret.
#  - Any other NAME=value pairs can be merged later with: prepare-secret.sh NAME (value read from stdin).
# Profiles: LO_PROFILE (lunar account, default "lunar") and HVAC_PROFILE (default "hvac-automations").
set -euo pipefail
region="${LO_REGION:-us-west-2}"
secret="${LO_SECRET:-lunar-optimize/app}"
lunar="${LO_PROFILE:-lunar}"
hvac="${HVAC_PROFILE:-hvac-automations}"

current="$(aws secretsmanager get-secret-value --profile "$lunar" --region "$region" --secret-id "$secret" --query SecretString --output text 2>/dev/null || echo '{}')"

if [ "${1:-}" != "" ]; then
  name="$1"
  value="$(cat)"
  merged="$(NAME="$name" VALUE="$value" CURRENT="$current" python3 -c 'import json,os
d=json.loads(os.environ["CURRENT"]); d[os.environ["NAME"]]=os.environ["VALUE"]; print(json.dumps(d))')"
else
  dfs="$(aws secretsmanager get-secret-value --profile "$hvac" --region "$region" --secret-id hvac-automations/openseo-env --query SecretString --output text \
    | python3 -c 'import json,sys
env=json.load(sys.stdin)["env"]
for line in env.splitlines():
    if line.startswith("DATAFORSEO_API_KEY="): print(line.split("=",1)[1].strip())')"
  merged="$(DFS="$dfs" CURRENT="$current" python3 -c 'import json,os,secrets
d=json.loads(os.environ["CURRENT"])
d.setdefault("BETTER_AUTH_SECRET", secrets.token_urlsafe(48))
if os.environ["DFS"]: d["DATAFORSEO_API_KEY"]=os.environ["DFS"]
print(json.dumps(d))')"
fi

if [ "$current" = "{}" ]; then
  aws secretsmanager create-secret --profile "$lunar" --region "$region" --name "$secret" --secret-string "$merged" \
    --tags Key=Product,Value=lunar-optimize --query Name --output text
else
  aws secretsmanager put-secret-value --profile "$lunar" --region "$region" --secret-id "$secret" --secret-string "$merged" --query Name --output text
fi
echo "keys now in $secret: $(printf '%s' "$merged" | python3 -c 'import json,sys; print(" ".join(sorted(json.load(sys.stdin))))')"
