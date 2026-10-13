#!/usr/bin/env bash
set -euo pipefail
: "${COMPOSE_PROJECT_NAME:?Set the Dokploy project name from docker compose ls}"
# Restore to a NEW database only. Never overwrite the production database.
: "${RESTORE_DATABASE:?Choose a new staging database name}"
[[ "$RESTORE_DATABASE" =~ ^restore_[a-zA-Z0-9_]+$ ]] || { echo 'Use restore_ prefix'; exit 1; }
task_dump=${1:?Pass the downloaded custom-format database.dump}
test -s "$task_dump"
docker compose -f docker-compose.dokploy.yml exec -T postgres \
  sh -ec 'createdb -U "$POSTGRES_USER" "$1"' sh "$RESTORE_DATABASE"
docker compose -f docker-compose.dokploy.yml exec -T postgres \
  sh -ec 'pg_restore --exit-on-error --no-owner -U "$POSTGRES_USER" -d "$1"' sh "$RESTORE_DATABASE" \
  < "$task_dump"
echo "Restored into $RESTORE_DATABASE. Check row counts and app reads before accepting the backup."
