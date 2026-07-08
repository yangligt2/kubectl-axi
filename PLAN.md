# kubectl-axi - Build Plan

Kubernetes troubleshooting CLI for agents, built on [AXI](https://github.com/kunchenguid/axi) (Agent eXperience Interface). Wraps `kubectl` with truncated diagnostic views, pre-computed triage aggregates, and TOON output.

## Why this tool (summary of the analysis)

- kubectl's *list* views are already compact and agents know the syntax well. The waste is in the *diagnostic* views: `describe` (150-400 lines, mostly irrelevant), `get -o yaml`, unsorted `events`, unbounded `logs`.
- The strongest AXI levers here are **P3 (content truncation)** and **P4 (pre-computed aggregates)**, not P1 (TOON). Troubleshooting is inherently multi-turn (get pods -> describe -> logs -> events -> workload -> node); collapsing that loop into 1-2 turns is the prize. Turn count dominated cost in both existing AXI benchmarks.
- Sleeper wins: fixing kubectl footguns that cost agents turns - events not time-sorted by default, forgetting `logs --previous` on crash loops, multi-container `-c` errors, services with zero endpoints.
- Design it as **a k8s troubleshooting tool that happens to wrap kubectl**, not a kubectl mirror with TOON output.

## Locked decisions (Phase 0)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Name | `kubectl-axi` (npm package + bin) | kubectl dispatches any `kubectl-*` binary on PATH as a plugin, so a global npm install makes `kubectl axi triage` work natively. Name reserved on npm 2026-07-08 (0.0.1 placeholder published). |
| Repo | [yangligt2/kubectl-axi](https://github.com/yangligt2/kubectl-axi), community AXI | Standalone repo matching the reference-implementation pattern; the umbrella axi repo gets `bench-k8s/` and a community catalog row. |
| v1 scope | **Read-only** | Troubleshooting is 95% reads. "This tool cannot break your cluster" is a headline feature and cuts P6 idempotency work to zero. Mutations (rollout restart, scale) are v1.1. |
| Stack | Node 20+, TypeScript, `axi-sdk-js` | Bootstrapped from the gh-axi skeleton. SDK provides CLI runner, fail-loud flag validation, 3-agent hooks installer, self-update (~1,900 lines free). |
| Escape hatch | Raw `kubectl`, documented in skill/README | Unlike `gh-axi api`, kubectl is already on every PATH and agents know it. No passthrough command. |

## Architecture rules

1. **Every command parses `kubectl get ... -o json` and projects it down internally. Never scrape `describe` or table output.** The JSON API is version-stable; describe text is not. `describe` is something kubectl-axi replaces, not wraps.
2. Context plumbing mirrors gh-axi's `-R`/`--hostname` pattern: `-n/--namespace`, `-A/--all-namespaces`, `--context` resolved once and threaded to every kubectl invocation.
3. Aggregate commands fan out parallel kubectl calls internally; the agent sees one invocation.
4. TOON at the output boundary only; internal logic stays on JSON. Flatten nested resources into diagnostic projections (events, container statuses, node conditions) which are uniform arrays - the shape TOON is good at.
5. Errors follow AXI P6: structured, on stdout, actionable suggestion, no kubectl stderr leaking through raw. Exit 0 success / 1 error / 2 usage.
6. Session hook (if installed) reads **kubeconfig-local facts only** (current context + namespace). Zero API calls at session start - a hook that touches the cluster can hang on dead contexts, trigger SSO refresh, and leak cluster state ambiently.

## Command surface v1 (read-only)

Build in this order; each step independently shippable:

1. `pods` / `pods view <pod>` - the autopsy view: phase, container statuses flattened to a TOON table (name, state, reason, exit code, restarts, last termination), pod-scoped warning events inline, probe summary. Replaces `describe pod` + `get events`.
2. `logs <pod>` - default `--tail 100`, truncation with total-size hint (P3), auto-detect single container vs self-correcting `-c` error listing container names, auto-surface `--previous` when the container has restarted.
3. `events` - time-sorted descending by default (fixes kubectl's worst default), warnings first, `-A` support.
4. `triage [-n ns | -A]` - the flagship P4 aggregate: non-ready pods, deployments below desired, pending PVCs, node pressure conditions, recent warning events - one ranked report.
5. `deploy` / `deploy view` (ready/desired, rollout conditions), `nodes` / `nodes view` (conditions, pressure, allocatable summary), `svc view <name>` (selector vs matching pods vs endpoints - the zero-endpoints diagnosis in one call).
6. Home view (no args, P8): bin path, one-line description, current context + namespace, non-ready pod count in current namespace (single fast API call), suggestions footer.

## Fault fixtures (double as dev environment, e2e bed, and benchmark substrate)

`fixtures/faults/*.yaml` applied to a kind cluster via one `make cluster-up`:

1. CrashLoopBackOff (bad command; diagnosis needs `logs --previous`)
2. OOMKilled (10Mi limit; diagnosis in `lastState.terminated.reason`)
3. ImagePullBackOff (typo'd tag)
4. Failing readiness probe (Running but not Ready)
5. Missing ConfigMap/Secret ref (CreateContainerConfigError)
6. Init container failure
7. Unschedulable pod (impossible nodeSelector / taint)
8. Pending PVC (nonexistent storage class)
9. Service with zero endpoints (label mismatch)
10. Stuck rollout (progressDeadlineExceeded)
11. Multi-container pod, one container broken (forces `-c` handling)
12. Healthy namespace (tests P5: "nothing is wrong" must be a confident, definitive answer)

Injected faults make LLM-judge grading hints deterministic ("correct answer: pod X is OOMKilled due to a 10Mi memory limit").

## Phases

- **Phase 0 - Lock decisions** (done, see table above). Reserve npm name with a 0.0.1 placeholder publish.
- **Phase 1 - Spec via benchmark tasks + fault fixtures** (done). `bench/tasks.yaml` holds 14 tasks in the bench-github format; `fixtures/faults/` holds the 12 fixtures; `make cluster-up`/`remote-up` + `verify` bring up and validate the kind cluster (local or on a remote docker host over SSH).
- **Phase 2 - Repo bootstrap** (done). TS package on `axi-sdk-js` following the gh-axi skeleton: cli/args/context/kubectl/toon/errors/suggestions modules, fail-loud per-subcommand flag validation, `pods` (list + view) and the home snapshot landed end-to-end with mocked-kubectl unit tests and verified live against the fixture cluster. Deferred to Phase 4: CI workflows, release-please config, skill build (and restoring pnpm `minimumReleaseAge`, which corporate proxy registries break locally).
- **Phase 3 - Command surface** (done). `logs` (tail default, 20k-char cap, restart-aware --previous hints, self-correcting multi-container errors), `events` (newest first, --warnings), `triage` (7 parallel reads -> one ranked report; cluster-wide by default; degrades per-check with explicit skip notes), `deploy`/`nodes`/`svc` (degraded-first sorting, endpoint readiness inline, selector-vs-pods diagnosis). Verified live: triage surfaces all 11 fixture faults in one call.
- **Phase 4 - Distribution artifacts** (2-3 days). Generated skill + drift test, README with the three install paths (zero-setup `npx -y`, skill via `npx skills add`, global install + hooks), `setup hooks` (kubeconfig-local only), catalog PR to the axi repo.
- **Phase 5 - bench-k8s** (1-2 weeks, the main deliverable). Adapt `bench-github/src/runner.ts`: cluster lifecycle (kind up, apply faults, wait ready, run agent, reset between repeats) replaces repo cloning. Conditions: `kubectl-axi` vs raw `kubectl` vs `kubectl + skill` (recipes only - isolates tool vs guidance) vs a k8s MCP server (e.g. `containers/kubernetes-mcp-server`). LLM-judge grading reused verbatim.

## Testing strategy

- Unit: mocked kubectl JSON fixtures (gh-axi pattern - tests mock the wrapped binary).
- E2E: kind cluster with the fault fixtures.
- Benchmark: Phase 5 harness, published to the axi repo like `bench-github/published-results/`.

## Open questions

- LICENSE copyright holder (placeholder: "kubectl-axi contributors" until decided).
- Whether `triage` should also walk Deployment -> ReplicaSet -> Pod ownership to attribute pod failures to workloads in v1, or defer to v1.1.
- Minimum supported kubectl / cluster version skew policy (proposal: rely only on long-stable `-o json` fields; CI e2e against the two most recent kind node images).
