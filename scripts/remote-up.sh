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

# Merge the cluster's context into ~/.kube/config so plain
# `kubectl --context kind-<cluster>` works locally once the tunnel is up.
# The user's current-context is preserved (home config listed first wins),
# stale entries from a previous cluster are replaced, and a backup is kept.
# Opt out with MERGE_KUBECONFIG=0.
if [ "${MERGE_KUBECONFIG:-1}" = "1" ]; then
  mkdir -p "${HOME}/.kube"
  if [ -f "${HOME}/.kube/config" ]; then
    cp "${HOME}/.kube/config" "${HOME}/.kube/config.bak-kubectl-axi"
    for kctx in delete-context delete-cluster delete-user; do
      kubectl config --kubeconfig="${HOME}/.kube/config" "${kctx}" "kind-${CLUSTER_NAME}" >/dev/null 2>&1 || true
    done
    KUBECONFIG="${HOME}/.kube/config:${ROOT}/.kube/config" \
      kubectl config view --flatten > "${HOME}/.kube/config.merge-tmp"
    mv "${HOME}/.kube/config.merge-tmp" "${HOME}/.kube/config"
  else
    cp "${ROOT}/.kube/config" "${HOME}/.kube/config"
  fi
  chmod 600 "${HOME}/.kube/config"
  echo "context kind-${CLUSTER_NAME} merged into ~/.kube/config (backup: ~/.kube/config.bak-kubectl-axi)" >&2
fi

echo "" >&2
echo "kubeconfig written to .kube/config (server https://127.0.0.1:${API_SERVER_PORT})" >&2
echo "next:" >&2
echo "  make tunnel          # forward 127.0.0.1:${API_SERVER_PORT} over SSH" >&2
echo "  kubectl --context kind-${CLUSTER_NAME} get ns   # plain local kubectl now works" >&2
echo "  make verify-local    # verify fixtures through the tunnel" >&2
