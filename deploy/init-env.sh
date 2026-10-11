#!/bin/sh
# Writes /opt/smartly/.env once: generates every secret the app signs or
# encrypts with, fills in the production settings, and asks for the keys of
# outside services. An existing .env is never overwritten.
set -eu
cd "$(dirname "$0")"

if [ -e .env ]; then
  echo ".env already exists -- edit it with: nano $PWD/.env" >&2
  exit 1
fi

secret() { openssl rand -base64 64 | tr -d '\n/+=' | cut -c1-48; }

# ask VAR "Question" [hidden]: reads one line; hidden input isn't echoed.
ask() {
  printf '%s: ' "$2" >&2
  [ "${3:-}" = hidden ] && stty -echo 2>/dev/null || true
  IFS= read -r answer || answer=""
  [ "${3:-}" = hidden ] && { stty echo 2>/dev/null || true; printf '\n' >&2; }
  eval "$1=\$answer"
}

echo "Keys from outside services (from Google Cloud, Better Auth, Resend, imgbb). Enter skips one." >&2
ask google_id "GOOGLE_CLIENT_ID"
ask google_secret "GOOGLE_CLIENT_SECRET (hidden)" hidden
ask dash_key "BETTER_AUTH_API_KEY (hidden)" hidden
ask resend_key "RESEND_API_KEY (hidden)" hidden
ask imgbb_key "IMGBB_API_KEY (hidden)" hidden
ask mail_from "MAIL_FROM [onboarding@resend.dev]"

umask 077
cat > .env <<ENV
# Written by init-env.sh on $(date -u +%Y-%m-%d). Private: never copy it anywhere.
POSTGRES_PASSWORD=$(openssl rand -hex 24)

BETTER_AUTH_SECRET=$(secret)
BETTER_AUTH_URL=https://smartly.softech.agency
ADMIN_FRONTEND_URL=https://smartly.softech.agency
USER_FRONTEND_URL=https://smartly.softech.agency
GOOGLE_CLIENT_ID=$google_id
GOOGLE_CLIENT_SECRET=$google_secret
BETTER_AUTH_API_KEY=$dash_key

JWT_SECRET=$(secret)
JWT_REFRESH_SECRET=$(secret)
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
USER_JWT_SECRET=$(secret)
USER_JWT_REFRESH_SECRET=$(secret)
USER_JWT_ACCESS_EXPIRES_IN=15m
USER_JWT_REFRESH_EXPIRES_IN=7d

USAGE_TRACKING_API_KEY=$(secret)
VAULT_ENCRYPTION_KEY=$(openssl rand -hex 32)
VAULT_TOKEN_SECRET=$(secret)
VAULT_TOKEN_EXPIRES_IN=10m

IMGBB_API_KEY=$imgbb_key
RESEND_API_KEY=$resend_key
MAIL_FROM=${mail_from:-onboarding@resend.dev}
ENV
echo "Wrote $PWD/.env (readable by root only)." >&2
