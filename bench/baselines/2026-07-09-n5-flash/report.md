# bench-k8s report

Runs: 210

| Condition | Runs | Success | Avg Input Tokens | Avg Output Tokens | Avg Cost | Avg Duration | Avg Turns |
| --- | --- | --- | --- | --- | --- | --- | --- |
| kubectl-axi | 70 | 94% | 84,311 | 869 | $0.015 | 45.6s | 6.8 |
| kubectl | 70 | 100% | 90,346 | 906 | $0.016 | 29.3s | 7.7 |
| kubectl-skill | 70 | 100% | 90,409 | 932 | $0.016 | 31.2s | 7.6 |

## Failures

| Condition | Task | Run | Reason | Details |
| --- | --- | --- | --- | --- |
| kubectl-axi | diagnose_unschedulable | 3 | policy_violation | command used forbidden tooling: kubectl get node kubectl-axi-bench-control-plane -o jsonpath='{.metadata.labels}' |
| kubectl-axi | diagnose_rollout | 2 | policy_violation | command used forbidden tooling: kubectl get deploy checkout -n fault-rollout -o yaml |
| kubectl-axi | diagnose_rollout | 3 | policy_violation | command used forbidden tooling: kubectl get rs,po -n fault-rollout |
| kubectl-axi | diagnose_readiness | 4 | policy_violation | command used forbidden tooling: kubectl get deployment frontend -n fault-readiness -o yaml |
