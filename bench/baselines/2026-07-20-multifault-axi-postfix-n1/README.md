# Multi-fault suite, kubectl-axi post-fix traces (2026-07-20)

Regenerated traces for the kubectl-axi condition after product rounds
2-3 (env/quota/port views, cm/secret/quota listers, nodes-list labels).
Agent gemini-3.1-pro-preview, n=1, current grading methodology
(correctness + fallback_count). Compare against the committed pre-fix
baseline 2026-07-10-multifault-pro-n1 (kubectl-axi 1/4 under the old
strict policy; kubectl 4/4; kubectl-skill 4/4).

Result: 4/4 PASS. See kubectl-axi.jsonl for per-run fallback counts.
Note: the original post-round-3 sweep (2026-07-10, also 4/4, fallbacks
in 1 of 4 runs) lost its traces to a crashed matrix run; this rerun
replaces them. Run-to-run turn counts vary (n=1).
