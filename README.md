# kubectl-axi

Kubernetes troubleshooting CLI for agents - designed with [AXI](https://github.com/kunchenguid/axi) (Agent eXperience Interface).

**Status: under development.** Version 0.0.1 is a placeholder release reserving the package name.

Wraps `kubectl` with token-efficient diagnostic views (pod autopsy, sorted events, truncated logs) and pre-computed triage aggregates that collapse the multi-turn debug loop (get pods -> describe -> logs -> events) into a single call. Read-only in v1: this tool cannot break your cluster.

Because the installed binary is named `kubectl-axi`, kubectl's plugin mechanism also exposes it as `kubectl axi`.

See [PLAN.md](PLAN.md) for the build plan.

## Development

### Fixture cluster

The dev/benchmark environment is a kind cluster seeded with 12 fixtures ([fixtures/faults/](fixtures/faults/)): crash loops, OOM kills, image pull failures, probe misconfigurations, stuck rollouts, selector mismatches, and one healthy namespace as the definitive-negative control. [bench/tasks.yaml](bench/tasks.yaml) defines the troubleshooting tasks graded against them.

Local mode (kind + docker on this machine):

```sh
make cluster-up      # create cluster, apply fixtures
make verify          # wait for all 12 fixtures to reach steady state
make cluster-down
```

Remote mode (kind + docker on another host, passwordless SSH):

```sh
echo 'REMOTE_HOST=<host>' > .env.local
make remote-up       # sync fixtures, create cluster there, fetch + merge kubeconfig
make tunnel          # forward the API server to 127.0.0.1:6443
make verify-local    # verify through the tunnel
make tunnel-down && make remote-down   # teardown (also removes merged kubeconfig entries)
```

`remote-up` merges the `kind-kubectl-axi-bench` context into your `~/.kube/config` (current context untouched, backup kept at `~/.kube/config.bak-kubectl-axi`), so once the tunnel is up plain `kubectl --context kind-kubectl-axi-bench` works directly. Set `MERGE_KUBECONFIG=0` to opt out.

## License

MIT
