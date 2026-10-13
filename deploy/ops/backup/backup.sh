#!/bin/sh
# One logical backup of the smartly database. From travelar_backend/ops/backup.
#
# Custom format (-Fc): compressed, and pg_restore can restore it selectively
# and in parallel. Written to a .partial file and renamed only when pg_dump
# succeeds, so a half-written dump never looks like a good one -- and never
# counts toward retention.
#
# Restore into the running stack (replaces the data). The maintenance flag
# keeps the deploy timer from starting the API (and re-running migrations)
# halfway through:
#   touch /opt/smartly/.maintenance
#   docker stop smartly-web smartly-api
#   docker exec -i smartly-db pg_restore --clean --if-exists --no-owner -U smartly -d smartly < /opt/smartly/backups/<file>.dump
#   docker start smartly-api smartly-web
#   rm /opt/smartly/.maintenance
set -eu

# Dumps hold every customer's data: readable by root only.
umask 077

: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/smartly-$stamp.dump"

rm -f "$BACKUP_DIR"/*.partial
pg_dump --format=custom --no-owner --no-privileges --file="$target.partial"
mv "$target.partial" "$target"

# Retention: only complete dumps older than the window, never the one just made.
find "$BACKUP_DIR" -name 'smartly-*.dump' -type f -mtime +"$RETENTION_DAYS" ! -path "$target" -delete

echo "[backup] ok $target ($(du -h "$target" | cut -f1)); keeping ${RETENTION_DAYS} days"
