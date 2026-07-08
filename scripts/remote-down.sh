#!/usr/bin/env bash
# Delete the bench cluster on the remote workstation.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "${ROOT}/.env.local" ] && . "${ROOT}/.env.local"
: "${REMOTE_HOST:?set REMOTE_HOST (or put REMOTE_HOST=... in .env.local)}"
CLUSTER_NAME="${CLUSTER_NAME:-kubectl-axi-bench}"

ssh "${REMOTE_HOST}" "kind delete cluster --name ${CLUSTER_NAME}"
rm -f "${ROOT}/.kube/config"

# Remove the merged entries from ~/.kube/config (no-ops if absent).
if [ -f "${HOME}/.kube/config" ]; then
  for kctx in delete-context delete-cluster delete-user; do
    kubectl config --kubeconfig="${HOME}/.kube/config" "${kctx}" "kind-${CLUSTER_NAME}" >/dev/null 2>&1 || true
  done
fi
echo "cluster ${CLUSTER_NAME} deleted on ${REMOTE_HOST}; local kubeconfig entries removed" >&2
