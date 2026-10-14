#!/usr/bin/env bash
#
# Blocks tenant containers and Docker builds from reaching the cloud instance
# metadata service (IMDS, 169.254.169.254).
#
# Why: every deploy runs a user's install and build scripts, and every running
# site is user code. From inside a container, IMDS hands out the EC2 instance
# role's temporary AWS credentials. Nothing in the app can stop that — it is a
# host network rule.
#
# DOCKER-USER is the chain Docker reserves for operator rules; it sees all
# traffic forwarded from containers (tenant network, default bridge, and build
# containers alike) and Docker never flushes it. Host processes are unaffected.
#
# Installs a systemd unit so the rule survives reboots and Docker restarts.
# Idempotent: safe to re-run.
#
# Usage (on the host):   sudo scripts/harden-host.sh
# Verify:                docker run --rm curlimages/curl -m 3 http://169.254.169.254/  # must time out

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

UNIT=/etc/systemd/system/dropdeploy-block-imds.service

cat > "$UNIT" <<'EOF'
[Unit]
Description=Block container access to the cloud metadata service (DropDeploy)
After=docker.service
Requires=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'iptables -C DOCKER-USER -d 169.254.169.254/32 -j DROP 2>/dev/null || iptables -I DOCKER-USER -d 169.254.169.254/32 -j DROP'
ExecStart=/bin/sh -c 'command -v ip6tables >/dev/null || exit 0; ip6tables -L DOCKER-USER >/dev/null 2>&1 || exit 0; ip6tables -C DOCKER-USER -d fd00:ec2::254/128 -j DROP 2>/dev/null || ip6tables -I DOCKER-USER -d fd00:ec2::254/128 -j DROP'

[Install]
WantedBy=docker.service
EOF

systemctl daemon-reload
systemctl enable --now dropdeploy-block-imds.service
systemctl restart dropdeploy-block-imds.service

echo "IMDS blocked for containers:"
iptables -S DOCKER-USER | grep 169.254.169.254

cat <<'EOF'

Second layer — require IMDSv2 with a hop limit of 1, so even a container that
somehow reaches IMDS cannot complete the token handshake. Run from a machine
with AWS credentials (not from inside this instance's containers):

  aws ec2 modify-instance-metadata-options \
    --instance-id <this-instance-id> \
    --http-tokens required \
    --http-put-response-hop-limit 1 \
    --http-endpoint enabled
EOF
