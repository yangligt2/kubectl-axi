#!/usr/bin/env bash
# Delete the bench cluster on the remote workstation.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "${ROOT}/.env.local" ] && . "${ROOT}/.env.local"
: "${REMOTE_HOST:?set REMOTE_HOST (or put REMOTE_HOST=... in .env.local)}"
CLUSTER_NAME="${CLUSTER_NAME:-kubectl-axi-bench}"

ssh "${REMOTE_HOST}" "kind delete cluster --name ${CLUSTER_NAME}"
rm -f "${ROOT}/.kube/config"
echo "cluster ${CLUSTER_NAME} deleted on ${REMOTE_HOST}" >&2
