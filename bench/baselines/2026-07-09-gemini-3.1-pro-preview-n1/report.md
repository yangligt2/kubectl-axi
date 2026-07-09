# bench-k8s report

Runs: 42

| Condition | Runs | Success | Avg Input Tokens | Avg Output Tokens | Avg Cost | Avg Duration | Avg Turns |
| --- | --- | --- | --- | --- | --- | --- | --- |
| kubectl-axi | 14 | 93% | 51,707 | 367 | $0.062 | 43.0s | 5.2 |
| kubectl | 14 | 100% | 70,602 | 554 | $0.087 | 29.0s | 7.1 |
| kubectl-skill | 14 | 93% | 133,250 | 512 | $0.129 | 57.9s | 11.7 |

## Failures

| Condition | Task | Run | Reason | Details |
| --- | --- | --- | --- | --- |
| kubectl-axi | diagnose_endpoints | 1 | policy_violation | command used forbidden tooling: kubectl get deploy -n fault-endpoints -o yaml \| grep -A 5 labels |
| kubectl-skill | diagnose_endpoints | 1 | judge_parse_error | judge output unparseable: Error: Reached max turns (1) |
