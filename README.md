# kubectl-axi

Kubernetes troubleshooting CLI for agents - designed with [AXI](https://github.com/kunchenguid/axi) (Agent eXperience Interface).

**Status: under development.** Version 0.0.1 is a placeholder release reserving the package name.

Wraps `kubectl` with token-efficient diagnostic views (pod autopsy, sorted events, truncated logs) and pre-computed triage aggregates that collapse the multi-turn debug loop (get pods -> describe -> logs -> events) into a single call. Read-only in v1: this tool cannot break your cluster.

Because the installed binary is named `kubectl-axi`, kubectl's plugin mechanism also exposes it as `kubectl axi`.

See [PLAN.md](PLAN.md) for the build plan.

## License

MIT
