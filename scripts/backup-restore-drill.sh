#!/usr/bin/env bash
set -euo pipefail
: "${RESTIC_REPOSITORY:?Set repository}"
umask 077
task_tmp=$(mktemp -d)
test_db="chicago-restore-drill-$(date +%s)-$$"
test_redis="${test_db}-redis"
cleanup() {
  docker rm -fv "$test_db" "$test_redis" >/dev/null 2>&1 || true
  rm -rf -- "$task_tmp"
}
trap cleanup EXIT
# Select the tagged snapshot explicitly, not an unrelated backup in the repository.
restic dump --tag chicago-pizza latest chicago-pizza.tar > "$task_tmp/backup.tar"
tar -xf "$task_tmp/backup.tar" -C "$task_tmp" application.dump dokploy.dump redis.rdb dokploy-config.tar.gz
tar -tzf "$task_tmp/dokploy-config.tar.gz" >/dev/null
# No published ports, no production network, no production volumes.
docker run -d --name "$test_db" --network none --memory 384m \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for attempt in $(seq 1 60); do
  if docker exec "$test_db" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$test_db" pg_isready -U postgres >/dev/null
docker exec "$test_db" createdb -U postgres application
docker exec -i "$test_db" pg_restore -U postgres -d application --no-owner --no-acl --exit-on-error < "$task_tmp/application.dump"
docker exec "$test_db" createdb -U postgres panel
docker exec -i "$test_db" pg_restore -U postgres -d panel --no-owner --no-acl --exit-on-error < "$task_tmp/dokploy.dump"
docker exec "$test_db" psql -U postgres -d application -v ON_ERROR_STOP=1 -Atc \
  'SELECT json_build_object('"'"'products'"'"', (SELECT count(*) FROM products), '"'"'users'"'"', (SELECT count(*) FROM users), '"'"'orders'"'"', (SELECT count(*) FROM orders));'
docker create --name "$test_redis" --network none --memory 128m redis:7-alpine \
  redis-server --save '' --appendonly no --maxmemory 64mb >/dev/null
docker cp "$task_tmp/redis.rdb" "$test_redis:/data/dump.rdb" >/dev/null
docker start "$test_redis" >/dev/null
for attempt in $(seq 1 30); do
  if docker exec "$test_redis" redis-cli ping >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$test_redis" redis-cli ping | grep -qx PONG
docker exec "$test_redis" redis-check-rdb /data/dump.rdb >/dev/null
echo 'Both databases and Redis restored in isolated disposable containers; configuration archive readable'
