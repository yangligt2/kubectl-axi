#!/usr/bin/env bash
# Verify every fixture has reached its expected steady state.
# Retries until TIMEOUT (default 300s). Works wherever kubectl can reach the
# cluster: on the kind host directly, or locally through an SSH tunnel with
# KUBECONFIG pointing at the fetched config.
set -uo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-kubectl-axi-bench}"
CTX="kind-${CLUSTER_NAME}"
TIMEOUT="${TIMEOUT:-300}"

k() { kubectl --context "${CTX}" "$@" 2>/dev/null; }

check_crashloop() {
  rc="$(k -n fault-crashloop get pods -o jsonpath='{.items[0].status.containerStatuses[0].restartCount}')"
  [ "${rc:-0}" -ge 2 ]
}
check_oom() {
  k -n fault-oom get pods -o jsonpath='{.items[*].status.containerStatuses[*].lastState.terminated.reason}' | grep -q OOMKilled
}
check_imagepull() {
  k -n fault-imagepull get pods -o jsonpath='{.items[*].status.containerStatuses[*].state.waiting.reason}' | grep -Eq 'ImagePullBackOff|ErrImagePull'
}
check_readiness() {
  out="$(k -n fault-readiness get pods -o jsonpath='{.items[0].status.phase}/{.items[0].status.conditions[?(@.type=="Ready")].status}')"
  [ "${out}" = "Running/False" ]
}
check_configmap() {
  k -n fault-configmap get pods -o jsonpath='{.items[*].status.containerStatuses[*].state.waiting.reason}' | grep -q CreateContainerConfigError
}
check_init() {
  rc="$(k -n fault-init get pods -o jsonpath='{.items[0].status.initContainerStatuses[0].restartCount}')"
  [ "${rc:-0}" -ge 1 ]
}
check_unschedulable() {
  k -n fault-unschedulable get pods -o jsonpath='{.items[0].status.conditions[?(@.type=="PodScheduled")].reason}' | grep -q Unschedulable
}
check_pvc() {
  [ "$(k -n fault-pvc get pvc data-cache -o jsonpath='{.status.phase}')" = "Pending" ]
}
check_endpoints() {
  k -n fault-endpoints get endpoints web >/dev/null || return 1
  [ -z "$(k -n fault-endpoints get endpoints web -o jsonpath='{.subsets}')" ]
}
check_rollout() {
  k -n fault-rollout get deploy checkout -o jsonpath='{.status.conditions[?(@.type=="Progressing")].reason}' | grep -q ProgressDeadlineExceeded
}
check_multicontainer() {
  rc="$(k -n fault-multicontainer get pods -o jsonpath='{.items[0].status.containerStatuses[?(@.name=="log-shipper")].restartCount}')"
  [ "${rc:-0}" -ge 1 ]
}
check_healthy() {
  [ "$(k -n healthy get deploy storefront -o jsonpath='{.status.readyReplicas}')" = "2" ]
}
check_shop() {
  k -n shop-checkout get pods -o jsonpath='{.items[*].status.containerStatuses[*].state.waiting.reason}' | grep -q CreateContainerConfigError || return 1
  rc="$(k -n shop-checkout get pods -l app=web -o jsonpath='{.items[0].status.containerStatuses[0].restartCount}')"
  [ "${rc:-0}" -ge 1 ]
}
check_payments() {
  k -n payments get pods -o jsonpath='{.items[0].status.conditions[?(@.type=="PodScheduled")].reason}' | grep -q Unschedulable
}
check_inventory() {
  [ "$(k -n inventory get pods --no-headers 2>/dev/null | wc -l | tr -d ' ')" = "1" ] &&
    [ "$(k -n inventory get deploy inventory -o jsonpath='{.spec.replicas}')" = "3" ]
}
check_quietops() {
  [ "$(k -n quiet-ops get job db-migrate -o jsonpath='{.status.succeeded}')" = "1" ] &&
    [ "$(k -n quiet-ops get pods -l app=web -o jsonpath='{.items[0].status.containerStatuses[0].ready}')" = "true" ]
}

FIXTURES="crashloop oom imagepull readiness configmap init unschedulable pvc endpoints rollout multicontainer healthy shop payments inventory quietops"

deadline=$((SECONDS + TIMEOUT))
while :; do
  pending=""
  for f in ${FIXTURES}; do
    "check_${f}" || pending="${pending} ${f}"
  done
  if [ -z "${pending}" ]; then
    echo "OK: all fixtures reached expected steady state"
    exit 0
  fi
  if [ "${SECONDS}" -ge "${deadline}" ]; then
    echo "TIMEOUT after ${TIMEOUT}s; not in steady state:${pending}" >&2
    exit 1
  fi
  echo "waiting for:${pending}" >&2
  sleep 10
done
