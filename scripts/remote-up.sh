#!/usr/bin/env bash
# Bring up the bench cluster on a remote workstation that has kind + docker,
# then fetch a kubeconfig usable locally through an SSH tunnel.
#
# Requires REMOTE_HOST (env or .env.local). Passwordless SSH assumed.
# After this completes:   make tunnel   then   make verify-local
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "${ROOT}/.env.local" ] && . "${ROOT}/.env.local"
: "${REMOTE_HOST:?set REMOTE_HOST (or put REMOTE_HOST=... in .env.local)}"
CLUSTER_NAME="${CLUSTER_NAME:-kubectl-axi-bench}"
API_SERVER_PORT="${API_SERVER_PORT:-6443}"
REMOTE_DIR="${REMOTE_DIR:-kubectl-axi-bench}"

echo "syncing fixtures and scripts to ${REMOTE_HOST}:${REMOTE_DIR}" >&2
rsync -a --delete "${ROOT}/fixtures" "${ROOT}/scripts" "${REMOTE_HOST}:${REMOTE_DIR}/"

echo "running cluster-up on ${REMOTE_HOST}" >&2
ssh "${REMOTE_HOST}" \
  "cd ${REMOTE_DIR} && CLUSTER_NAME=${CLUSTER_NAME} API_SERVER_PORT=${API_SERVER_PORT} bash scripts/cluster-up.sh"

mkdir -p "${ROOT}/.kube"
ssh "${REMOTE_HOST}" "kind get kubeconfig --name ${CLUSTER_NAME}" > "${ROOT}/.kube/config"
chmod 600 "${ROOT}/.kube/config"

echo "" >&2
echo "kubeconfig written to .kube/config (server https://127.0.0.1:${API_SERVER_PORT})" >&2
echo "next:" >&2
echo "  make tunnel          # forward 127.0.0.1:${API_SERVER_PORT} over SSH" >&2
echo "  make verify-local    # verify fixtures through the tunnel" >&2
