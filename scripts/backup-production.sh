#!/usr/bin/env bash
set -euo pipefail
: "${COMPOSE_PROJECT_NAME:?Set the Dokploy project name from docker compose ls}"
: "${RESTIC_REPOSITORY:?Set an off-server restic repository}"
if [[ -z "${RESTIC_PASSWORD:-}" && -z "${RESTIC_PASSWORD_FILE:-}" ]]; then
  echo 'Set RESTIC_PASSWORD_FILE (preferred) or RESTIC_PASSWORD' >&2
  exit 1
fi
command -v restic >/dev/null
umask 077
state_dir=${BACKUP_STATE_DIR:-/var/lib/chicago-backup}
mkdir -p "$state_dir"
exec 9>"$state_dir/backup.lock"
flock -n 9 || { echo 'Another backup is running' >&2; exit 1; }
task_tmp=$(mktemp -d "$state_dir/staging.XXXXXX")
trap 'rm -rf -- "$task_tmp"' EXIT
app_db="${COMPOSE_PROJECT_NAME}-postgres-1"
docker exec "$app_db" \
  sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z0' \
  > "$task_tmp/application.dump"
test -s "$task_tmp/application.dump"
docker exec -i "$app_db" pg_restore --list < "$task_tmp/application.dump" >/dev/null

# Redis contains sessions, carts and durable mail jobs; the cache is disposable.
redis="${COMPOSE_PROJECT_NAME}-redis-1"
redis_env=()
if [[ -n "${BACKUP_REDIS_PASSWORD:-}" ]]; then
  redis_env=(-e "REDIS_PASSWORD=$BACKUP_REDIS_PASSWORD")
fi
docker exec "${redis_env[@]}" "$redis" sh -ec 'REDISCLI_AUTH="${REDIS_PASSWORD:?Redis password missing}" redis-cli --rdb /tmp/chicago-backup.rdb' >/dev/null
docker cp "$redis:/tmp/chicago-backup.rdb" "$task_tmp/redis.rdb" >/dev/null
docker exec "$redis" rm -f /tmp/chicago-backup.rdb
test -s "$task_tmp/redis.rdb"

panel_db=${DOKPLOY_DB_CONTAINER:-}
if [[ -z "$panel_db" ]]; then
  panel_db=$(docker ps --filter label=com.docker.swarm.service.name=dokploy-postgres --format '{{.ID}}')
fi
if [[ -z "$panel_db" ]]; then
  panel_db=$(docker ps --filter 'name=^/dokploy-postgres$' --format '{{.ID}}')
fi
[[ -n "$panel_db" && "$panel_db" != *$'\n'* ]] || { echo 'Expected exactly one Dokploy database' >&2; exit 1; }
docker exec "$panel_db" sh -ec '
  if [ -n "${POSTGRES_PASSWORD_FILE:-}" ]; then POSTGRES_PASSWORD=$(cat "$POSTGRES_PASSWORD_FILE"); fi
  export PGPASSWORD="$POSTGRES_PASSWORD"
  pg_dump -U "${POSTGRES_USER:-dokploy}" -d "${POSTGRES_DB:-dokploy}" -Fc -Z0
' > "$task_tmp/dokploy.dump"
test -s "$task_tmp/dokploy.dump"
docker exec -i "$panel_db" pg_restore --list < "$task_tmp/dokploy.dump" >/dev/null
tar -czf "$task_tmp/dokploy-config.tar.gz" --exclude='*/.git' --exclude='*/node_modules' \
  --exclude='*/.next' --exclude='*/logs' -C /etc dokploy

# Stable archive names preserve deduplication although staging paths are unique.
# Initialize the repository once explicitly; never initialize after a failed connection.
tar -cf - -C "$task_tmp" application.dump dokploy.dump redis.rdb dokploy-config.tar.gz |
  restic backup --host chicago-pizza-production --tag chicago-pizza --stdin --stdin-filename chicago-pizza.tar
# Keep the most recent backup even if the server clock changes. Prune weekly,
# rather than listing/repacking the entire S3 repository every hour.
if [[ "$(date +%u%H)" == '703' || "${BACKUP_PRUNE:-false}" == true ]]; then
  restic forget --tag chicago-pizza --group-by host,tags --keep-last 1 \
    --keep-hourly 24 --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
fi
date +%s > "$state_dir/last-success.tmp"
mv "$state_dir/last-success.tmp" "$state_dir/last-success"
echo 'Encrypted off-server backup completed'
