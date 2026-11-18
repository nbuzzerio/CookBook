#!/usr/bin/env bash
set -euo pipefail
: "${RECIPES_DEPLOY_KEY:?Missing recipes-production secret RECIPES_DEPLOY_KEY}"
: "${RECIPES_SSH_HOST:?Missing RECIPES_SSH_HOST}" "${RECIPES_SSH_PORT:?Missing RECIPES_SSH_PORT}"
: "${RECIPES_SSH_HOST_KEY:?Missing RECIPES_SSH_HOST_KEY}" "${ARTIFACT_SHA256:?Missing CI artifact digest}"
[[ "$RECIPES_SSH_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || { echo "Invalid SSH hostname" >&2; exit 1; }
if ! [[ "$RECIPES_SSH_PORT" =~ ^[1-9][0-9]{0,4}$ ]] || (( RECIPES_SSH_PORT > 65535 )); then
  echo "Invalid SSH port" >&2
  exit 1
fi
[[ "$RECIPES_SSH_HOST_KEY" =~ ^ssh-ed25519\ [A-Za-z0-9+/]+=*$ ]] || { echo "Expected one pinned ED25519 public key" >&2; exit 1; }
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ && "$ARTIFACT_SHA256" =~ ^[0-9a-f]{64}$ ]]
printf '%s  %s\n' "$ARTIFACT_SHA256" "$1" | sha256sum --check --status

umask 077
keys=$(mktemp -d)
trap 'rm -f "$keys/id" "$keys/known_hosts"; rmdir "$keys"' EXIT
printf '%s\n' "$RECIPES_DEPLOY_KEY" | tr -d '\r' > "$keys/id"
unset RECIPES_DEPLOY_KEY
printf 'recipes-droplet %s\n' "$RECIPES_SSH_HOST_KEY" > "$keys/known_hosts"
ssh-keygen -lf "$keys/known_hosts" >/dev/null

# Concurrency serializes deploy jobs, but GitHub does not order them by push time.
head_sha=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq '.object.sha')
[[ "$head_sha" == "$GITHUB_SHA" ]] || { echo "Superseded commit. Deploy the current main run." >&2; exit 1; }
unset GH_TOKEN
ssh -T -F /dev/null -i "$keys/id" -p "$RECIPES_SSH_PORT" \
  -o StrictHostKeyChecking=yes -o HostKeyAlias=recipes-droplet -o HostKeyAlgorithms=ssh-ed25519 \
  -o GlobalKnownHostsFile=/dev/null -o "UserKnownHostsFile=$keys/known_hosts" \
  -o BatchMode=yes -o IdentitiesOnly=yes -o PreferredAuthentications=publickey \
  -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  "recipes-deploy@$RECIPES_SSH_HOST" "publish $GITHUB_SHA $ARTIFACT_SHA256" < "$1"
