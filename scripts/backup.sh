#!/usr/bin/env bash
#
# Backs up everything a DropDeploy host cannot rebuild from git:
#   - the Postgres database (users, projects, env vars, domains, deployments)
#   - uploaded / statically-built sites        ($DATA_DIR/static-sites)
#   - each project's persistent /data volume   (docker volumes dropdeploy-data-*)
#
# Git clones and Docker images are not backed up: every deploy recreates them.
#
# Env vars in the database are encrypted with ENV_ENCRYPTION_KEY, which is NOT
# in the backup. Keep a copy of the app's .env somewhere safe and separate —
# without that key the encrypted values cannot be restored.
#
# Usage (as the deploy user, who is in the docker group):
#   scripts/backup.sh
#
# Cron, nightly at 03:15:
#   15 3 * * * /home/ubuntu/ShipEntri/scripts/backup.sh >> /home/ubuntu/logs/backup.log 2>&1
#
# Environment overrides:
#   APP_DIR=/home/ubuntu/ShipEntri       (where .env is read from)
#   DATA_DIR=/home/ubuntu/.dropdeploy
#   BACKUP_DIR=/home/ubuntu/backups
#   RETENTION_DAYS=14
#   BACKUP_S3_URI=s3://bucket/dropdeploy   (optional: also copy off the host; needs aws cli)

set -euo pipefail
umask 077   # backups contain every user's data

APP_DIR=${APP_DIR:-/home/ubuntu/ShipEntri}
DATA_DIR=${DATA_DIR:-/home/ubuntu/.dropdeploy}
BACKUP_DIR=${BACKUP_DIR:-/home/ubuntu/backups}
RETENTION_DAYS=${RETENTION_DAYS:-14}

stamp=$(date -u +%Y%m%dT%H%M%SZ)
dest="$BACKUP_DIR/$stamp"
mkdir -p "$dest"
log() { echo "[$(date -u +%FT%TZ)] $*"; }

# DATABASE_URL from the app's .env, without sourcing (the file is not a shell script).
DATABASE_URL=${DATABASE_URL:-$(sed -n 's/^DATABASE_URL=//p' "$APP_DIR/.env" | tr -d '"' | tail -1)}
[[ -n "$DATABASE_URL" ]] || { echo "DATABASE_URL not found in $APP_DIR/.env" >&2; exit 1; }

log "database"
pg_dump --format=custom --no-owner --file "$dest/database.dump" "$DATABASE_URL"

if [[ -d "$DATA_DIR/static-sites" ]]; then
  log "static sites"
  tar -C "$DATA_DIR" -czf "$dest/static-sites.tar.gz" static-sites
fi

volumes=$(docker volume ls -q --filter name=dropdeploy-data- || true)
if [[ -n "$volumes" ]]; then
  mkdir -p "$dest/volumes"
  for vol in $volumes; do
    log "volume $vol"
    docker run --rm --network none -v "$vol":/v:ro -v "$dest/volumes":/out alpine \
      tar -C /v -czf "/out/$vol.tar.gz" .
  done
fi

log "wrote $(du -sh "$dest" | cut -f1) to $dest"

if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  log "copying to $BACKUP_S3_URI/$stamp"
  aws s3 cp --recursive --only-show-errors "$dest" "$BACKUP_S3_URI/$stamp"
fi

# Retention: remove local backups older than RETENTION_DAYS.
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*Z' -mtime +"$RETENTION_DAYS" -exec rm -rf {} +
log "done"

# Restore, for reference:
#   pg_restore --clean --no-owner -d "$DATABASE_URL" database.dump
#   tar -C "$DATA_DIR" -xzf static-sites.tar.gz
#   docker volume create dropdeploy-data-<slug>
#   docker run --rm -v dropdeploy-data-<slug>:/v -v "$PWD/volumes":/in alpine tar -C /v -xzf /in/dropdeploy-data-<slug>.tar.gz
