#!/usr/bin/env bash
# Stage 2 -- starts the smartly stack, creates the first super admin and the
# reference data, and installs the three timers. Safe to re-run; after a
# `git pull` it installs the updated scripts.
#
#   bash install.sh
#
# Touches no other project: the stack publishes no port and only smartly-web
# joins the proxy network. The site stays unreachable until attach-site.sh
# adds its vhost.
#
# Timers, all no-ops in the common case:
#   smartly-deploy  every 2 min -- pulls newly published images and rolls
#                   forward, or back if the new release is not healthy
#   smartly-vhost   every 2 min -- re-attaches the vhost if a furnify deploy
#                   dropped it
#   smartly-cert    daily       -- renews the certificate when it is due
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
. "$SRC/lib.sh"

require_root
[ -f "$APP_DIR/docker-compose.yml" ] || die "$APP_DIR/docker-compose.yml not found -- run bootstrap.sh first"
load_domain
for key in POSTGRES_PASSWORD BETTER_AUTH_SECRET JWT_SECRET JWT_REFRESH_SECRET USER_JWT_SECRET USER_JWT_REFRESH_SECRET \
  USAGE_TRACKING_API_KEY VAULT_ENCRYPTION_KEY VAULT_TOKEN_SECRET SUPER_ADMIN_EMAIL SUPER_ADMIN_PASSWORD API_IMAGE WEB_IMAGE; do
  [ -n "$(env_get "$key")" ] || die "$key is empty in $ENV_FILE"
done
is_placeholder_email "$(env_get SUPER_ADMIN_EMAIL)" && die "SUPER_ADMIN_EMAIL in $ENV_FILE is not a real email address"

step "1. Scripts"
# A copy that does not depend on the git clone staying where it is.
rm -rf "$LIB_DIR"
mkdir -p "$LIB_DIR"
cp -r "$SRC/lib.sh" "$SRC/ensure-site.sh" "$SRC/nginx" "$SRC/agent" "$LIB_DIR/"
chmod 0755 "$LIB_DIR/ensure-site.sh" "$LIB_DIR"/agent/*.sh
ok "installed into $LIB_DIR"

step "2. First release"
cd "$APP_DIR"
# Retried: the image layers come from GitHub's blob storage, and a dropped
# connection there fails the whole pull. Finished layers are kept between tries.
pulled=0
for attempt in 1 2 3; do
  if docker compose pull smartly-db smartly-migrate smartly-api smartly-web smartly-backup; then pulled=1; break; fi
  if [ "$attempt" -lt 3 ]; then
    info "pull attempt $attempt failed -- retrying in 20 s"
    sleep 20
  fi
done
if [ "$pulled" != 1 ]; then
  die "could not pull the images after 3 attempts. Nothing was started. Read the error above:
       * 'denied' or 'unauthorized'
         -> the package is private: GitHub -> Packages -> cashfo_backend / cashfo -> Package settings -> Change visibility -> Public
       * 'manifest unknown'
         -> nothing published yet: merge to main and wait for the Deploy workflow to go green
       * 'connection reset', 'TLS handshake' or a timeout
         -> this server's connection to GitHub's package storage is failing; try again later"
fi
# The agent does the rest: start, wait for health, report.
bash "$LIB_DIR/agent/smartly-deploy.sh" || die "the stack did not become healthy -- see the logs above"
docker ps --filter name=smartly- --format '     {{.Names}}  {{.Status}}'

step "3. Super admin and reference data"
# Idempotent: an existing super admin is left as is, and plans an admin has
# edited are not reset. Prints no password -- it lives in .env.
docker compose --profile tools run --rm smartly-bootstrap \
  || die "bootstrap failed -- see the output above"
ok "sign in as $(env_get SUPER_ADMIN_EMAIL); password: grep SUPER_ADMIN_PASSWORD $ENV_FILE"

# The release agent only watches the two containers that serve traffic. A
# backup job stuck restarting would otherwise go unnoticed until the day a
# backup is needed.
sleep 5
backup_state=$(docker inspect -f '{{.State.Status}} (restarts: {{.RestartCount}})' smartly-backup 2>/dev/null || echo missing)
case "$backup_state" in
  "running (restarts: 0)") ok "smartly-backup running" ;;
  *)
    printf '\033[33m WARN\033[0m  smartly-backup is %s -- no backups are being taken. Its log:\n' "$backup_state"
    docker logs --tail 10 smartly-backup 2>&1 | sed 's/^/        /'
    ;;
esac

step "4. Timers"
for unit in smartly-deploy smartly-vhost smartly-cert; do
  install -m 0644 "$SRC/agent/$unit.service" /etc/systemd/system/
  install -m 0644 "$SRC/agent/$unit.timer"   /etc/systemd/system/
done
systemctl daemon-reload
systemctl enable --now smartly-deploy.timer smartly-vhost.timer smartly-cert.timer
systemctl list-timers 'smartly-*' --no-pager | head -5

cat <<EOF

$(printf '\033[1mStage 2 done.\033[0m') The stack is running, reachable only inside Docker.

Next: bash $SRC/attach-site.sh
  first time: certificate + nginx vhost for $DOMAIN
  after a git pull: applies any change to the vhost (graceful reload only)
EOF
