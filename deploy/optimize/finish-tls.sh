#!/usr/bin/env bash
# Operator-run (Git Bash): copy and run box-finish-tls.sh on the Studio box. Output also goes to finish-tls.log.
set -euo pipefail
here=/c/Users/XanderGamelo/.LunarProjectPrime/.tmp/cf/lo-release
export AWS_CA_BUNDLE='C:\Users\XanderGamelo\.codex\visualizations\2026\09\22\01a0c69b-a5c8-74e2-8efb-c06cfb2577b0\windows-trusted-ca.pem'
key=C:/Users/XanderGamelo/.ssh/openclaw-deploy
push_key() { aws ec2-instance-connect send-ssh-public-key --profile lunar --region us-west-2 --instance-id i-0f90d81b0a911d4b9 --instance-os-user ubuntu --ssh-public-key file://C:/Users/XanderGamelo/.ssh/openclaw-deploy.pub --query Success --output text >/dev/null; }
push_key
scp -i "$key" "$here/box-finish-tls.sh" ubuntu@54.186.157.251:/tmp/lo-release/
push_key
ssh -i "$key" ubuntu@54.186.157.251 'bash /tmp/lo-release/box-finish-tls.sh' 2>&1 | tee "$here/finish-tls.log"
