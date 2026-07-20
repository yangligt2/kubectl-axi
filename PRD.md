# PRD: kubectl-axi - Agent-Optimized Kubernetes Troubleshooting Interface

| | |
| --- | --- |
| Status | Shipped (v0.0.2 on npm) - hackathon submission |
| Author | yangligt |
| Repo / Package | [github.com/yangligt2/kubectl-axi](https://github.com/yangligt2/kubectl-axi) / `npm i -g kubectl-axi` |
| Related | [AXI - Agent eXperience Interface](https://github.com/kunchenguid/axi) (design principles this product implements) |

## 1. Summary

kubectl-axi is a **read-only, agent-native CLI for Kubernetes troubleshooting**. AI agents today debug clusters through kubectl - a CLI designed for humans - paying for it in context-window tokens, round trips, and risk (a general-purpose CLI lets a "diagnose" task mutate the cluster). kubectl-axi wraps kubectl behind an interface built for agent ergonomics: pre-computed one-call diagnoses, token-efficient TOON output, definitive answers, self-correcting errors, and a hard read-only guarantee.

In a 420-run LLM-judged benchmark, kubectl-axi matched raw kubectl's 100% task success while using **18% fewer input tokens, 20% fewer turns, and 21% lower cost per diagnosis** (Gemini 3.1 Pro tier, n=5).

## 2. Problem

AI agents are increasingly the first responder for "why is my app down" on Kubernetes. Their interface options are poor:

- **Raw kubectl** is verbose by design for humans: `describe pod` returns 150-400 lines to answer one question, `get events` is not time-sorted, crash diagnosis needs `logs --previous` that agents forget, and a typical pod diagnosis takes 5-8 round trips (get pods, describe, logs, events, deployment, node). Every round trip costs tokens, latency, and money.
- **Kubernetes MCP servers** carry per-session schema overhead and (in the parallel AXI benchmarks for GitHub and browser domains) cost 2-3x more than CLI access at lower success rates.
- **Safety is implicit, not structural.** During our benchmarking, an unconstrained agent asked only to *diagnose* a broken service silently *patched the service selector* to fix it - contaminating the environment. Nothing in kubectl prevents this.

The users deploying these agents range from seasoned SREs to developers who touch Kubernetes only because their stack runs there - so the interface must diagnose expert-grade faults (quota exhaustion, stuck rollouts) and novice-grade mistakes (wrong ports, misnamed services, missing secrets) equally well.

## 3. Goals and non-goals

**Goals**

1. Cut the token/turn/cost budget of Kubernetes diagnosis for agents, at equal-or-better success rates, measured by a reproducible benchmark.
2. Collapse multi-step diagnostic loops into single calls (cluster triage, pod autopsy, service wiring check).
3. Be structurally incapable of damaging the cluster: read-only verbs only.
4. Zero-setup adoption for any agent that can run shell commands; auth inherits the existing kubeconfig.

**Non-goals (v1)**

- Mutations (restart, scale, delete) - deferred to v1.1 with idempotent semantics.
- Full kubectl surface coverage or CRDs - raw kubectl remains the documented escape hatch.
- Cluster management (provisioning, upgrades), monitoring/alerting.

## 4. Product principles

kubectl-axi implements the 10 [AXI principles](https://axi.md); the load-bearing ones for this domain:

- **Pre-computed aggregates (P4)**: the most expensive token is a follow-up call. `triage` fans out 8 parallel API reads and returns one ranked cluster-health report. `pods view` merges describe + events + limits + probes into one autopsy.
- **Content truncation (P3)**: logs default to the last 100 lines with a 20k-char cap and size hints; event messages are trimmed; escape hatches are suggested only when truncation happened.
- **Definitive states (P5)**: "pods: none found in namespace x" is an answer; a nonexistent namespace is `NOT_FOUND`, not an empty list; healthy means "nothing is broken", stated confidently.
- **Fail loud (P6)**: unknown flags are rejected with the valid flag list inline; errors are structured with actionable next commands; multi-container ambiguity names the failing container in the error.
- **Read-only by construction**: no mutating verb exists in the binary; secret values are never displayed.

## 5. Functional requirements (shipped)

**Command surface** (all output TOON-encoded with counts and next-step hints):

| Command | Requirement it satisfies |
| --- | --- |
| `triage [-n ns]` | One-call cluster health scan: not-ready pods, degraded/stuck rollouts (including full-replica ProgressDeadline cases), pending PVCs, services with zero ready endpoints, exhausted ResourceQuotas, node pressure, last-hour warnings. Per-check degradation with explicit skip notes. |
| `pods` / `pods view` | Lists sort not-ready first. Autopsy shows container states, last terminations (OOMKilled + exit codes), restart counts, declared ports next to probe targets, env summaries, resource limits, pod-scoped events, node-selector match counts, and cross-checks every referenced ConfigMap/Secret (even on Pending pods - masked faults are latent, not just symptomatic). |
| `logs` | Tail default, size-capped, restart-aware `--previous` hints, self-correcting container selection. |
| `events` | Newest-first (fixes kubectl's unsorted default), `--warnings` filter. |
| `deploy` / `deploy view` | Degraded-first; selector + pod-template labels; env summary; ReplicaSet warning events (quota/admission failures that never produce a Pending pod). |
| `svc` / `svc view` | Endpoint readiness inline on list; view compares selector vs matching pods vs endpoints and states the diagnosis (label mismatch, unready backends, targetPort matching no declared containerPort). |
| `nodes`, `pvc`, `cm`, `secret`, `quota` | Readiness/pressure/labels; PVC-to-StorageClass diagnosis; existence/verification listers (secret values never shown; quota used-vs-hard with AT LIMIT flag). |
| `ctx`, `setup hooks` | Kubeconfig-local context snapshot; SessionStart hook installer (Claude Code, Codex, OpenCode) that never calls the cluster at session start. |

**Distribution**: `npx -y kubectl-axi` (zero install), installable Agent Skill (`npx skills add yangligt2/kubectl-axi --skill kubectl-axi -g`, generated from the CLI's own help with a CI drift check), global npm install (also enables `kubectl axi` via kubectl's plugin dispatch). Publishing is release-please with npm provenance attestations.

## 6. Non-functional requirements

- **Token budget** is a first-class constraint: minimal default schemas, TOON at the output boundary, JSON internally.
- **Version-stable**: every command parses `kubectl get -o json`; human-oriented output (describe, tables) is never scraped.
- **Auth**: inherits kubeconfig; adds no credentials, servers, or daemons.
- **Ambient safety**: session hooks read only the local kubeconfig - no API calls, no hangs on dead clusters, no SSO refresh prompts, no ambient cluster-state leakage.

## 7. Results (measured)

**Primary benchmark** - 14 troubleshooting tasks x 3 conditions x 5 repeats x 2 agent-model tiers = 420 runs against a kind cluster with deterministic injected faults; LLM judge (claude-sonnet-4-6); grading on correctness with raw-kubectl fallbacks tracked as a separate coverage metric. Costs computed from per-run token counts at official Gemini pricing.

Gemini 3.1 Pro (n=70 per condition):

| Condition | Success | Fallback runs | Avg input tokens | Avg turns | Avg cost |
| --- | --- | --- | --- | --- | --- |
| **kubectl-axi** | **100%** | 8.6% | **56,160** | **5.5** | **$0.056** |
| kubectl + written guidance | 100% | 0% | 56,434 | 6.7 | $0.062 |
| kubectl (raw) | 100% | n/a | 68,074 | 6.9 | $0.070 |

Gemini 3.5 Flash: all conditions 100%; kubectl-axi leads tokens (84,311 vs 90,346) and turns (6.8 vs 7.7) at parity cost. Notably, the advantage *widens* on the stronger model, and guidance-only captured some token savings but not the turn savings - the tool, not the advice, removes round trips.

**Multi-fault suite** (compound/masked faults modeled on real incidents: a 3-mistake novice app, a masked fault behind a scheduling failure, quota silently capping replicas, and an alarming-but-healthy control): kubectl-axi went from 1/4 before the coverage work to **4/4**, with remaining raw-kubectl fallbacks reduced to confirmatory checks. The suite also produced the read-only motivation above: a baseline agent mutated the cluster mid-diagnosis; the harness now reconciles fixtures before every run.

All datasets, per-run traces, and judge verdicts are committed under `bench/baselines/` for reproduction; the harness (`bench/`) is in-repo.

## 8. Risks and mitigations

- **LLMs know kubectl natively; wrapper adoption cost.** Mitigated by the installable skill (guidance loads on demand), `npx` zero-setup, and measured wins that grow with model capability.
- **Coverage gaps push agents back to raw kubectl.** Tracked as the fallback-rate metric (8.6% Pro); each fallback names the next surface to add. The escape hatch is documented and safe (read-only tasks).
- **kubectl/API drift.** Only long-stable `-o json` fields are consumed; CI runs against current kind images.

## 9. Roadmap

1. Publish the benchmark study and add kubectl-axi to the AXI community catalog.
2. v1.1: safe mutations (`rollout restart`, `scale`) with idempotent no-op semantics and explicit confirmation of what changed.
3. Expand the multi-fault suite (RBAC, DNS, image-registry auth) and re-baseline fallback rate toward 0%.
4. Namespace-unscoped "wide" incident tasks to benchmark triage under realistic on-call prompts.

## Appendix: artifacts

- Package: `kubectl-axi` on npm (v0.0.2, SLSA provenance) - bin also dispatches as `kubectl axi`
- Benchmark data: `bench/baselines/2026-07-09-n5-{pro,flash}/`, `2026-07-09-n5-REJUDGE.md`, `2026-07-10-multifault-pro-n1/`, `2026-07-20-multifault-axi-postfix-n1/`
- Fixtures: `fixtures/faults/` (16 scenarios) + `make cluster-up` / `make remote-up`
- Skill: `skills/kubectl-axi/SKILL.md` (generated, drift-checked in CI)
