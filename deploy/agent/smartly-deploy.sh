#!/usr/bin/env bash
# Pull-based release, run every 2 minutes by smartly-deploy.timer.
# Adapted from travelar_backend/deploy/agent/travelar-deploy.sh.
#
# Both repos publish to GHCR only after their quality gate is green; this is
# the other half. GitHub's runners cannot reach this host on port 22, so the
# release is pulled rather than pushed -- and no SSH key lives in GitHub.
#
# Does nothing unless an image digest changed. When one did:
#   docker compose up -d   recreates only what changed; a new API image runs
#                          smartly-migrate to completion before the API starts
#   waits for health       smartly-api (/health, which queries Postgres) and
#                          smartly-web (/login) must both report healthy
#   rolls back otherwise   the previous images are re-tagged and started again
#
# A rollback restores the code, not the schema. Migrations must therefore stay
# additive (new tables and nullable or defaulted columns) so the previous
# release still runs against a migrated database. A migration that FAILED is
# marked rolled back first (see resolve_failed_migrations), or Prisma would
# refuse to start even the previous release.
set -euo pipefail

APP_DIR=/opt/smartly
cd "$APP_DIR"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"; }
env_get() { sed -n "s/^$1=//p" .env | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; }

# One release at a time. The timer, install.sh and set-env.sh all end up in
# `docker compose up`; two racing over the same containers can fail a good
# release and reject its image for good. The timer skips a run while the lock
# is held; install.sh sets SMARTLY_LOCK_WAIT=1 to wait its turn instead.
exec 9>/run/lock/smartly-deploy.lock
if [ "${SMARTLY_LOCK_WAIT:-0}" = 1 ]; then
  flock -w 900 9 || { log "ERROR: another release held the lock for 15 minutes"; exit 1; }
elif ! flock -n 9; then
  log "another release is in progress -- skipping this run"
  exit 0
fi

# Hands-on maintenance (a restore, a pinned rollback): while this file exists
# the agent leaves the stack alone. `touch` it before, `rm` it after.
if [ -e "$APP_DIR/.maintenance" ]; then
  log "$APP_DIR/.maintenance is present -- not releasing"
  exit 0
fi

IMAGES=("$(env_get API_IMAGE)" "$(env_get WEB_IMAGE)")
CONTAINERS=(smartly-api smartly-web)

# Image ids that already failed a release. :latest keeps pointing at a bad
# build until the next push, so without this list every run would deploy it
# again -- a short outage every two minutes. A new push has a new id and is
# tried normally.
REJECTED="$APP_DIR/.rejected-images"
touch "$REJECTED"

# BEFORE is what each container is running, not where the local tag points:
# a pull that moved the tag without a release (a run killed between pull and
# up, install.sh's own pull, a failed pull of the other image) must still
# count as a change -- otherwise that image goes live unsupervised on some
# later `compose up`, and a rollback would restore it instead of the release
# that was really running.
declare -A BEFORE AFTER
for i in "${!IMAGES[@]}"; do
  image=${IMAGES[$i]}
  BEFORE[$image]=$(docker inspect --format '{{.Image}}' "${CONTAINERS[$i]}" 2>/dev/null \
    || docker image inspect --format '{{.Id}}' "$image" 2>/dev/null || echo none)
done

for image in "${IMAGES[@]}"; do
  if ! docker pull -q "$image" >/dev/null 2>&1; then
    log "pull of $image failed (registry unreachable, or the package is private) -- leaving the running release alone"
    exit 0
  fi
done

changed=()
for image in "${IMAGES[@]}"; do
  AFTER[$image]=$(docker image inspect --format '{{.Id}}' "$image")
  [ "${AFTER[$image]}" = "${BEFORE[$image]}" ] && continue
  if grep -qxF "${AFTER[$image]}" "$REJECTED"; then
    # Point the local tag back at the running release, so a compose run
    # triggered by the other image cannot pick the rejected one up.
    [ "${BEFORE[$image]}" != "none" ] && docker tag "${BEFORE[$image]}" "$image"
    continue
  fi
  changed+=("$image")
done

# Also start the stack if it is not running at all (first run, or after a
# reboot that Docker's restart policy did not cover).
running=$(docker ps --filter name='^smartly-(api|web)$' --format '{{.Names}}' | wc -l)
if [ "${#changed[@]}" -eq 0 ] && [ "$running" -eq 2 ]; then
  exit 0
fi

for image in "${changed[@]}"; do
  log "new image: $image ${BEFORE[$image]:7:12} -> ${AFTER[$image]:7:12}"
done

# A migration that failed leaves a row in _prisma_migrations that makes every
# later `prisma migrate deploy` stop with P3009 -- including the previous
# release's, so nothing would start and the timer would fail every two
# minutes. Prisma sends each migration to PostgreSQL as one script, which runs
# as a single transaction, so the failed one has already been undone; it is
# marked rolled back here, with the NEW image (the one that knows the
# migration), before the previous release is started again. A migration with
# statements that can't run in a transaction (CREATE INDEX CONCURRENTLY) must
# never be shipped for exactly this reason.
resolve_failed_migrations() {
  local failed name
  failed=$(docker exec smartly-db psql -U smartly -d smartly -At -c \
    "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL" 2>/dev/null) || return 0
  for name in $failed; do
    log "migration $name failed -- marking it rolled back so the previous release can start"
    docker compose run --rm --no-deps smartly-migrate node_modules/.bin/prisma migrate resolve --rolled-back "$name" \
      || log "ERROR: could not mark $name rolled back -- see 'When a migration fails' in deploy/README.md"
  done
}

rollback() {
  log "ERROR: $1 -- rolling back"
  # Before anything is recreated: afterwards these would be the old release's.
  log "output of the failed release:"
  docker compose logs --no-color --tail=60 smartly-migrate smartly-api smartly-web || true
  resolve_failed_migrations
  for image in "${changed[@]}"; do
    echo "${AFTER[$image]}" >> "$REJECTED"
    log "rejected ${AFTER[$image]:7:12} ($image) -- it will not be tried again; push a fix to release"
  done
  tail -n 50 "$REJECTED" > "$REJECTED.tmp" && mv "$REJECTED.tmp" "$REJECTED"
  for image in "${IMAGES[@]}"; do
    [ "${BEFORE[$image]}" != "none" ] && docker tag "${BEFORE[$image]}" "$image"
  done
  if docker compose up -d --remove-orphans; then
    log "previous release restored"
  else
    log "ERROR: the previous release did not start either -- check: docker compose -f $APP_DIR/docker-compose.yml ps"
  fi
  exit 1
}

docker compose up -d --remove-orphans || rollback "docker compose up failed (a failed migration shows in the output below)"

for _ in $(seq 1 30); do
  healthy=0
  for c in "${CONTAINERS[@]}"; do
    state=$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$c" 2>/dev/null || echo missing/)
    case "$state" in
      */healthy) healthy=$((healthy + 1)) ;;
      # Definitive: the healthcheck used up its retries, or the process died.
      # Waiting out the full five minutes would only extend the outage.
      */unhealthy|exited/*|dead/*) rollback "$c is ${state%/}" ;;
    esac
  done
  if [ "$healthy" -eq "${#CONTAINERS[@]}" ]; then
    log "healthy -- release complete"
    # Superseded smartly images only; other projects' images are left alone.
    docker image prune -f --filter "label=com.softech.project=smartly" --filter "until=168h" >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 10
done

rollback "not healthy after 5 minutes"
