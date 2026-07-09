# Baseline: Gemini 3.5 Flash, repeat 1 (2026-07-09)

One run per task (14 tasks) per condition against the static fixture
cluster. Agent: gemini-3.5-flash via @google/gemini-cli; judge:
claude-sonnet-4-6. Costs are DERIVED from token counts (the Gemini CLI
reports no cost) using the approximate rates in bench/src/gemini.ts.

| Condition | Success | Avg Input Tokens | Avg Cost | Avg Turns |
| --- | --- | --- | --- | --- |
| kubectl (raw) | 100% | 80,531 | $0.015 | 6.4 |
| kubectl-skill | 100% | 77,871 | $0.014 | 6.4 |
| kubectl-axi | 100% | 166,946 | $0.029 | 10.7 |

Caveats:
- n=1; the kubectl-axi average carries two outlier runs
  (diagnose_endpoints 39 turns - post-hoc "verification" spiral after a
  correct first command; cluster_triage 23 turns - agent re-verified the
  one-call triage answer per namespace).
- The kubectl-axi condition here used a SHORT hand-written guidance
  blurb, not the installable SKILL.md (agents paid a 1-4 `--help`
  discovery tax per task). Binary at commit 7bab52d (post pvc/scheduling
  fixes).
- Per-run traces (stream-json) are under <condition>/<task>/run1/.
