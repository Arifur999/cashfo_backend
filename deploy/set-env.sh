#!/usr/bin/env bash
# Sets values in /opt/smartly/.env by asking for them, then applies them.
# Nothing is typed into a command line (shell history) or pasted anywhere,
# and secrets are read without echo. Adapted from travelar_backend.
#
#   bash set-env.sh GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
#   bash set-env.sh RESEND_API_KEY MAIL_FROM
#   bash set-env.sh IMGBB_API_KEY BETTER_AUTH_API_KEY
#   bash set-env.sh KEY [KEY ...]          any setting in .env
#
# Values are stored single-quoted, which docker compose reads literally:
# spaces, #, $ and & are kept as typed. Only a single quote cannot be stored.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
. "$SRC/lib.sh"

require_root
[ -f "$ENV_FILE" ] || die "$ENV_FILE not found -- run bootstrap.sh first"
[ $# -gt 0 ] || die "usage: bash set-env.sh KEY [KEY ...]"

is_secret() { case "$1" in *PASS*|*SECRET*|*KEY) return 0 ;; *) return 1 ;; esac; }

# write_env KEY VALUE -- replaces the line in place, keeping the file's mode.
write_env() {
  local key=$1 value=$2 tmp
  case "$value" in *"'"*) die "$key: a single quote (') cannot be stored in .env -- choose a value without one" ;; esac
  case "$value" in *$'\n'*|*$'\r'*) die "$key: one line only" ;; esac
  tmp=$(mktemp)
  KEY="$key" VALUE="$value" awk '
    BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"]; done = 0 }
    index($0, k "=") == 1 { print k "='\''" v "'\''"; done = 1; next }
    { print }
    END { if (!done) print k "='\''" v "'\''" }
  ' "$ENV_FILE" > "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

# Answers come from the terminal, even when this script's stdin is not one;
# without a terminal (scripted use) they are read from stdin, one per line.
if { true </dev/tty; } 2>/dev/null; then IN=/dev/tty; else IN=/dev/stdin; fi

step "Values for $ENV_FILE (enter keeps the current one)"
changed=0
for key in "$@"; do
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "$key is not a setting name"
  value=""
  if is_secret "$key"; then
    read -rsp "  $key (hidden): " value <"$IN" || true; echo >&2
  else
    current=$(env_get "$key")
    read -rp "  $key${current:+ [$current]}: " value <"$IN" || true
  fi
  if [ -z "$value" ]; then
    info "$key unchanged"
    continue
  fi
  write_env "$key" "$value"
  changed=1
  ok "$key saved"
done

[ "$changed" = 1 ] || { info "nothing changed"; exit 0; }

step "Applying"
# Before install.sh has started the stack there is nothing to apply to --
# and starting it from here would be too early.
if [ -z "$(docker ps -q --filter name='^smartly-api$')" ]; then
  info "the stack is not running yet -- install.sh will start it with these values"
  exit 0
fi
# Recreates only the services whose settings changed (the API, usually).
( cd "$APP_DIR" && docker compose up -d ) || die "docker compose up failed -- see the output above"
ok "applied"
