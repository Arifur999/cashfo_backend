#!/bin/sh
# The forced command of the smartly deploy key in root's authorized_keys (see
# README.md): through it GitHub Actions can update one smartly service, and
# do nothing else on this server.
#
#   ssh root@<vps> "deploy api"     registry user, then token, on stdin
#
set -eu
cd "$(dirname "$0")"

case "${SSH_ORIGINAL_COMMAND:-}" in
  "deploy api") service=api ;;
  "deploy web") service=web ;;
  *) echo "usage: deploy api | deploy web" >&2; exit 2 ;;
esac

if ! read -r registry_user || ! read -r registry_token; then
  echo "expected the registry user and token on stdin" >&2
  exit 2
fi

# Registry credentials of our own, so root's Docker login -- and every other
# project's -- is never touched. Dropped again however the run ends.
export DOCKER_CONFIG="$PWD/.docker"
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
printf '%s' "$registry_token" | docker login ghcr.io --username "$registry_user" --password-stdin >/dev/null

docker compose pull "$service"
# Also starts what it depends on if that isn't running yet (first deploy),
# and waits for health, so a broken release fails the GitHub run.
docker compose up -d --wait --wait-timeout 180 "$service"

# Superseded smartly images only; other projects' images are left alone.
docker image prune -f --filter label=com.softech.project=smartly >/dev/null
echo "smartly $service deployed"
