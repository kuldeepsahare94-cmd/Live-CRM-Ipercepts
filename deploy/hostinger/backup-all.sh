#!/bin/bash
# Nightly backup of every customer database (keeps 14 days).
# crontab -e   ->   30 2 * * * /srv/icrm/app/deploy/hostinger/backup-all.sh
set -euo pipefail
ROOT=/srv/icrm; OUT=/srv/icrm/backups/$(date +%F); mkdir -p "$OUT"
for DB in $(sudo -u postgres psql -Atc "SELECT datname FROM pg_database WHERE datname LIKE 'icrm_%'"); do
  sudo -u postgres pg_dump -Fc "$DB" > "$OUT/$DB.dump"
done
find /srv/icrm/backups -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
# Restore one:  sudo -u postgres pg_restore --clean -d icrm_acme /srv/icrm/backups/<date>/icrm_acme.dump
