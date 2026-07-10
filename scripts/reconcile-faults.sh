#!/usr/bin/env bash
# Re-assert every fixture's desired state. Idempotent and fast; the bench
# runner calls this before each run so one agent's cluster mutations cannot
# contaminate later runs. Uses the caller's KUBECONFIG/current-context.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for f in "$ROOT"/fixtures/faults/*.yaml; do
  case "$f" in
    *10-rollout*) continue ;; # two-act fixture, handled below
  esac
  kubectl apply -f "$f" >/dev/null
done

# Fault 10 must stay a STUCK rollout. Re-applying its manifest would heal it
# (good image), so only re-break it when it is not currently stuck.
reason=$(kubectl -n fault-rollout get deploy checkout \
  -o jsonpath='{.status.conditions[?(@.type=="Progressing")].reason}' 2>/dev/null || echo "")
if [ "${reason}" != "ProgressDeadlineExceeded" ]; then
  kubectl apply -f "$ROOT/fixtures/faults/10-rollout.yaml" >/dev/null
  kubectl -n fault-rollout rollout status deploy/checkout --timeout 120s >/dev/null 2>&1 || true
  kubectl -n fault-rollout set image deploy/checkout app=nginx:2.0-does-not-exist >/dev/null
fi

echo "fixtures reconciled"
