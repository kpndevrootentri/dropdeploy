#!/usr/bin/env bash
#
# Runs the DropDeploy web app as its own user, without Docker access.
#
# Why: the web app parses every request from the internet and proxies every
# tenant site. While it runs as a member of the `docker` group, any remote-code
# bug in it is root on the host (`docker run -v /:/host --privileged ...`).
# The app no longer needs the socket — every Docker operation it makes goes
# through the worker (src/lib/docker-ops.ts) — so it can run as a user that
# cannot reach it.
#
# What this sets up:
#   - system user `dropdeploy-web`, NOT in the docker group
#   - read-only access to the app checkout (it must not be able to change code
#     the worker, which does hold Docker access, will later run)
#   - read access to .env
#   - read/write on the static-sites directory, shared with the worker user
#   - read/write on .next/cache only (re-applied by `after-build`)
#   - a systemd unit, dropdeploy-web.service, that also makes the Docker
#     socket inaccessible to the process outright
#
# The worker (deployment + docker-ops queues) keeps running under PM2 as the
# current deploy user, which stays in the docker group.
#
# Usage (on the host, as the deploy user with sudo):
#   sudo scripts/split-web-user.sh install      # one-time migration
#   sudo scripts/split-web-user.sh after-build  # after every `npm run build`
#
# Environment overrides (defaults match the production host):
#   APP_DIR=/home/ubuntu/ShipEntri   DATA_DIR=/home/ubuntu/.dropdeploy
#   DEPLOY_USER=ubuntu               APP_PORT=3000
#   SKIP_SYSTEMD=1                   (permissions only; for testing)
#
# Rollback:
#   sudo systemctl disable --now dropdeploy-web
#   pm2 start ecosystem.config.js --only dropdeploy-app && pm2 save

set -euo pipefail

WEB_USER=dropdeploy-web
APP_DIR=${APP_DIR:-/home/ubuntu/ShipEntri}
DATA_DIR=${DATA_DIR:-/home/ubuntu/.dropdeploy}
DEPLOY_USER=${DEPLOY_USER:-ubuntu}
APP_PORT=${APP_PORT:-3000}
STATIC_DIR="$DATA_DIR/static-sites"
UNIT=/etc/systemd/system/dropdeploy-web.service

die() { echo "error: $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root: sudo $0 ${1:-install}"
command -v setfacl >/dev/null || die "setfacl not found: sudo apt install -y acl"
[[ -d "$APP_DIR" ]] || die "APP_DIR $APP_DIR does not exist"

# Traverse (x only) every ancestor directory, so the user can reach the app
# and data directories without being able to list home directories.
grant_traverse() {
  local dir
  dir=$(dirname "$1")
  while [[ "$dir" != "/" ]]; do
    setfacl -m "u:$WEB_USER:x" "$dir"
    dir=$(dirname "$dir")
  done
}

apply_cache_acl() {
  local cache="$APP_DIR/.next/cache"
  if [[ ! -d "$APP_DIR/.next" ]]; then
    echo "no .next yet — run \`npm run build\`, then \`$0 after-build\`"
    return
  fi
  mkdir -p "$cache"
  chown -R "$DEPLOY_USER:" "$cache"
  # Existing and future entries: web user and deploy user both read/write.
  setfacl -R -m "u:$WEB_USER:rwX,u:$DEPLOY_USER:rwX" "$cache"
  setfacl -R -d -m "u:$WEB_USER:rwX,u:$DEPLOY_USER:rwX" "$cache"
  echo "web user can write $cache"
}

install() {
  if ! id "$WEB_USER" >/dev/null 2>&1; then
    useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$WEB_USER"
    echo "created user $WEB_USER"
  fi
  if id -nG "$WEB_USER" | tr ' ' '\n' | grep -qx docker; then
    gpasswd -d "$WEB_USER" docker
  fi

  grant_traverse "$APP_DIR"
  grant_traverse "$STATIC_DIR"

  # App checkout: read-only, including files a later `git pull` creates.
  setfacl -R -m "u:$WEB_USER:rX" "$APP_DIR"
  find "$APP_DIR" -type d -exec setfacl -d -m "u:$WEB_USER:rX" {} +
  # No write anywhere in the checkout, except the Next cache below.
  [[ -f "$APP_DIR/.env" ]] && setfacl -m "u:$WEB_USER:r" "$APP_DIR/.env"

  # Static sites: written by the web app (zip uploads) and by the worker
  # (static builds), replaced wholesale by either — both need full access,
  # and default ACLs keep that true for entries the other one creates.
  mkdir -p "$STATIC_DIR"
  chown "$DEPLOY_USER:" "$STATIC_DIR"
  setfacl -R -m "u:$WEB_USER:rwX,u:$DEPLOY_USER:rwX" "$STATIC_DIR"
  setfacl -R -d -m "u:$WEB_USER:rwX,u:$DEPLOY_USER:rwX" "$STATIC_DIR"

  apply_cache_acl

  if [[ "${SKIP_SYSTEMD:-}" == "1" ]]; then
    echo "SKIP_SYSTEMD=1: permissions applied, systemd unit not installed"
    return
  fi

  local node_bin
  node_bin=$(command -v node) || die "node not found in PATH"

  cat > "$UNIT" <<EOF
[Unit]
Description=DropDeploy web app (no Docker access)
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
User=$WEB_USER
Group=$WEB_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
Environment=NODE_ENV=production
ExecStart=$node_bin $APP_DIR/node_modules/next/dist/bin/next start -H 127.0.0.1 -p $APP_PORT
Restart=always
RestartSec=3

# Belt and braces on top of the group membership: the socket does not exist
# as far as this process can tell, even if permissions on it are ever loosened.
InaccessiblePaths=-/var/run/docker.sock -/run/docker.sock
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=-$STATIC_DIR -$APP_DIR/.next/cache
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload

  # Hand over from PM2: stop the old process first so the port is free.
  if sudo -u "$DEPLOY_USER" -H bash -lc 'command -v pm2 >/dev/null && pm2 describe dropdeploy-app >/dev/null 2>&1'; then
    sudo -u "$DEPLOY_USER" -H bash -lc 'pm2 delete dropdeploy-app && pm2 save'
    echo "removed dropdeploy-app from PM2 (the worker stays under PM2)"
  fi
  systemctl enable --now dropdeploy-web.service

  sleep 3
  verify
}

verify() {
  echo
  echo "== verification =="
  if sudo -u "$WEB_USER" test -r /var/run/docker.sock -o -w /var/run/docker.sock; then
    echo "FAIL: $WEB_USER can access the Docker socket"
    exit 1
  fi
  echo "ok: $WEB_USER cannot access the Docker socket"
  if sudo -u "$WEB_USER" test -w "$APP_DIR/package.json"; then
    echo "FAIL: $WEB_USER can modify the app checkout"
    exit 1
  fi
  echo "ok: app checkout is read-only for $WEB_USER"
  systemctl is-active --quiet dropdeploy-web && echo "ok: dropdeploy-web is running" \
    || { echo "FAIL: dropdeploy-web is not running — journalctl -u dropdeploy-web -n 50"; exit 1; }
  curl -fsS -o /dev/null "http://127.0.0.1:$APP_PORT/api/health" && echo "ok: app answers on 127.0.0.1:$APP_PORT" \
    || echo "WARN: health check did not answer yet — journalctl -u dropdeploy-web -n 50"
}

case "${1:-install}" in
  install) install ;;
  after-build)
    apply_cache_acl
    [[ "${SKIP_SYSTEMD:-}" == "1" ]] || systemctl restart dropdeploy-web.service
    ;;
  verify) verify ;;
  *) die "usage: $0 [install|after-build|verify]" ;;
esac
