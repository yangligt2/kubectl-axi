# Bench fixture cluster management.
#
# Local mode (kind + docker on this machine):
#   make cluster-up / make verify / make cluster-down
#
# Remote mode (kind + docker on a workstation, passwordless SSH):
#   echo 'REMOTE_HOST=<host>' > .env.local
#   make remote-up && make tunnel && make verify-local
#   make tunnel-down / make remote-down when finished

CLUSTER_NAME ?= kubectl-axi-bench
API_SERVER_PORT ?= 6443
-include .env.local

cluster-up:
	CLUSTER_NAME=$(CLUSTER_NAME) API_SERVER_PORT=$(API_SERVER_PORT) scripts/cluster-up.sh

verify:
	CLUSTER_NAME=$(CLUSTER_NAME) scripts/verify-faults.sh

cluster-down:
	kind delete cluster --name $(CLUSTER_NAME)

remote-up:
	CLUSTER_NAME=$(CLUSTER_NAME) API_SERVER_PORT=$(API_SERVER_PORT) scripts/remote-up.sh

remote-down:
	CLUSTER_NAME=$(CLUSTER_NAME) scripts/remote-down.sh

tunnel:
	@test -n "$(REMOTE_HOST)" || { echo "set REMOTE_HOST (or .env.local)"; exit 1; }
	ssh -f -N -M -S .ssh-tunnel.sock -o ExitOnForwardFailure=yes \
		-L $(API_SERVER_PORT):127.0.0.1:$(API_SERVER_PORT) $(REMOTE_HOST)
	@echo "tunnel up: 127.0.0.1:$(API_SERVER_PORT) -> $(REMOTE_HOST)"

tunnel-down:
	ssh -S .ssh-tunnel.sock -O exit $(REMOTE_HOST)

verify-local:
	KUBECONFIG=$(CURDIR)/.kube/config CLUSTER_NAME=$(CLUSTER_NAME) scripts/verify-faults.sh

.PHONY: cluster-up verify cluster-down remote-up remote-down tunnel tunnel-down verify-local
