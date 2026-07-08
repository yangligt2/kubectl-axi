# kubectl-axi

Kubernetes troubleshooting CLI for agents - designed with [AXI](https://github.com/kunchenguid/axi) (Agent eXperience Interface).

**Status: under development.** The published 0.0.1 is a name-reservation placeholder; the CLI is being built here.

Wraps `kubectl` with token-efficient diagnostic views (pod autopsy, sorted events, truncated logs) and pre-computed triage aggregates that collapse the multi-turn debug loop (get pods -> describe -> logs -> events) into a single call. Read-only in v1: this tool cannot break your cluster.

Because the installed binary is named `kubectl-axi`, kubectl's plugin mechanism also exposes it as `kubectl axi`.

See [PLAN.md](PLAN.md) for the build plan.

## Quick Start

Install the kubectl-axi skill in the [Agent Skills](https://agentskills.io) format with [`npx skills`](https://github.com/vercel-labs/skills):

```sh
npx skills add yangligt2/kubectl-axi --skill kubectl-axi -g
```

That is the entire setup - no npm install needed. The skill teaches your agent to run kubectl-axi through `npx -y kubectl-axi`, so the CLI comes along on demand. You still need `kubectl` on PATH with a working kubeconfig (Node 20+ required); kubectl-axi inherits kubectl's cluster access and adds no auth of its own.

### Other ways to install

**Zero setup** - any capable agent can run the CLI with nothing installed. Add to your CLAUDE.md / AGENTS.md:

```
Use `npx -y kubectl-axi` for Kubernetes troubleshooting.
```

**Session hook** - ambient context (current kubectl context + namespace, read from the local kubeconfig only, never the cluster) fed into every agent session:

```sh
npm install -g kubectl-axi
kubectl-axi setup hooks     # Claude Code, Codex, OpenCode; restart your session after
```

## Usage (so far)

```sh
kubectl-axi                     # cluster snapshot: context, namespace, not-ready pods
kubectl-axi triage              # one-call cluster health scan: not-ready pods, stuck rollouts,
                                #   pending PVCs, zero-endpoint services, node pressure, recent warnings
kubectl-axi pods                # list pods, not-ready sorted first
kubectl-axi pods -A             # across all namespaces
kubectl-axi pods view <name> -n <ns>   # pod autopsy: containers, last terminations, probes, recent events
kubectl-axi logs <pod> -n <ns>  # last 100 lines, size-capped; hints --previous after restarts;
                                #   multi-container pods get a self-correcting error naming the broken one
kubectl-axi events -A --warnings       # events newest-first (fixes kubectl's unsorted default)
kubectl-axi deploy              # deployments, degraded first (catches stuck rollouts at full replicas)
kubectl-axi svc view <name> -n <ns>    # selector vs matching pods vs endpoints - diagnoses zero-endpoint services
kubectl-axi nodes               # readiness + pressure conditions
kubectl-axi ctx                 # kubeconfig-local context/namespace (what the session hook prints)
kubectl-axi setup hooks         # install SessionStart hooks (Claude Code, Codex, OpenCode)
```

Global flags on any command: `-n/--namespace <ns>`, `-A/--all-namespaces`, `--context <name>`.

## Development

### CLI

```sh
pnpm install
pnpm run build       # compile TypeScript to dist/
pnpm run dev -- ...  # run the CLI with tsx
pnpm test            # vitest (kubectl mocked)
pnpm run lint
pnpm run build:skill # regenerate skills/kubectl-axi/SKILL.md (CI fails if it drifts)
```

Releases are cut by [release-please](https://github.com/googleapis/release-please) from conventional commits on `main`; merging the release PR publishes to npm with OIDC provenance. Do not hand-edit `CHANGELOG.md` or `.release-please-manifest.json` - a guard workflow blocks PRs that touch them.

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
