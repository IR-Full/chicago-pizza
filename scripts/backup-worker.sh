#!/usr/bin/env bash
set -euo pipefail
umask 077
mkdir -p /var/lib/chicago-backup
if [[ "${1:-}" == run ]]; then
  if ! timeout 2700 /opt/chicago-backup/backup-production.sh; then
    BACKUP_ALERT_FORCE=true python3 /opt/chicago-backup/backup-alert.py
    exit 1
  fi
  exit 0
fi
if [[ "${1:-}" == restore-drill ]]; then
  exec /opt/chicago-backup/backup-restore-drill.sh
fi
if [[ "${1:-}" == test-alert ]]; then
  export BACKUP_ALERT_TEST=true
  exec python3 /opt/chicago-backup/backup-alert.py
fi
# Persist a health marker and throttle email alerts in the state volume.
printf '%s\n' \
  '15 * * * * /opt/chicago-backup/backup-worker.sh run >>/proc/1/fd/1 2>>/proc/1/fd/2' \
  '*/30 * * * * python3 /opt/chicago-backup/backup-alert.py >>/proc/1/fd/1 2>>/proc/1/fd/2' \
  > /etc/crontabs/root
/opt/chicago-backup/backup-worker.sh run || true
exec crond -f -l 8
