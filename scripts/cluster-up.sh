#!/usr/bin/env bash
# Create the kubectl-axi bench kind cluster and apply all fault fixtures.
# Runs on whatever host has kind + docker (locally or a remote workstation
# via scripts/remote-up.sh). Idempotent: safe to re-run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-kubectl-axi-bench}"
API_SERVER_PORT="${API_SERVER_PORT:-6443}"
CTX="kind-${CLUSTER_NAME}"

command -v kind >/dev/null || { echo "error: kind not found on PATH" >&2; exit 1; }
command -v kubectl >/dev/null || { echo "error: kubectl not found on PATH" >&2; exit 1; }

if ! kind get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}"; then
  echo "creating kind cluster ${CLUSTER_NAME} (api server on 127.0.0.1:${API_SERVER_PORT})" >&2
  kind create cluster --name "${CLUSTER_NAME}" --wait 120s --config - <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
networking:
  apiServerAddress: "127.0.0.1"
  apiServerPort: ${API_SERVER_PORT}
nodes:
  - role: control-plane
EOF
else
  echo "cluster ${CLUSTER_NAME} already exists, reusing" >&2
fi

echo "applying fault fixtures" >&2
kubectl --context "${CTX}" apply -f "${ROOT}/fixtures/faults/"

# Fault 10, act 2: push a bad image onto the healthy checkout deployment so the
# rollout gets stuck (ProgressDeadlineExceeded) while old pods keep serving.
# Only performed while the deployment is still on the good image, so re-runs
# are no-ops.
current_image="$(kubectl --context "${CTX}" -n fault-rollout get deploy checkout \
  -o jsonpath='{.spec.template.spec.containers[0].image}')"
if [ "${current_image}" = "nginx:1.27-alpine" ]; then
  echo "fault-rollout: waiting for the v1 rollout to complete before breaking v2" >&2
  kubectl --context "${CTX}" -n fault-rollout rollout status deploy/checkout --timeout 180s >&2
  kubectl --context "${CTX}" -n fault-rollout set image deploy/checkout app=nginx:2.0-does-not-exist >&2
  echo "fault-rollout: v2 image set to nginx:2.0-does-not-exist (will stall)" >&2
else
  echo "fault-rollout: already on ${current_image}, skipping act 2" >&2
fi

echo "done. faults need up to ~3 minutes to reach steady state;" >&2
echo "run scripts/verify-faults.sh to confirm." >&2
