#!/usr/bin/env bash
set -euo pipefail
: "${COMPOSE_PROJECT_NAME:?Set the Dokploy project name from docker compose ls}"
# Run from the Dokploy checkout directory. Configure .env only for host-side
# commands; Dokploy's UI variables are not automatically present in your SSH shell.
: "${RESTIC_REPOSITORY:?Set an off-server restic repository}"
: "${RESTIC_PASSWORD:?Set the repository encryption password}"
command -v restic >/dev/null
umask 077
task_tmp=$(mktemp -d)
trap 'rm -f -- "$task_tmp/database.dump"; rmdir -- "$task_tmp"' EXIT
docker compose -f docker-compose.dokploy.yml exec -T postgres \
  sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$task_tmp/database.dump"
test -s "$task_tmp/database.dump"
# Initialize the repository once, explicitly, before scheduling this script.
restic backup --tag chicago-pizza --stdin --stdin-filename database.dump < "$task_tmp/database.dump"
restic forget --tag chicago-pizza --group-by tags --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
