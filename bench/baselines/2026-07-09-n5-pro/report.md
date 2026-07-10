# bench-k8s report

Runs: 210

| Condition | Runs | Success | Avg Input Tokens | Avg Output Tokens | Avg Cost | Avg Duration | Avg Turns |
| --- | --- | --- | --- | --- | --- | --- | --- |
| kubectl-axi | 70 | 91% | 56,160 | 394 | $0.066 | 22.0s | 5.5 |
| kubectl-skill | 70 | 100% | 56,434 | 504 | $0.072 | 22.0s | 6.7 |
| kubectl | 70 | 100% | 68,074 | 549 | $0.083 | 22.9s | 6.9 |

## Failures

| Condition | Task | Run | Reason | Details |
| --- | --- | --- | --- | --- |
| kubectl-axi | diagnose_configmap | 1 | policy_violation | command used forbidden tooling: kubectl get configmap -n fault-configmap |
| kubectl-axi | diagnose_configmap | 4 | policy_violation | command used forbidden tooling: kubectl get configmap -n fault-configmap |
| kubectl-axi | diagnose_unschedulable | 4 | policy_violation | command used forbidden tooling: kubectl get node kubectl-axi-bench-control-plane --show-labels |
| kubectl-axi | diagnose_unschedulable | 5 | policy_violation | command used forbidden tooling: kubectl get node kubectl-axi-bench-control-plane -o jsonpath='{.metadata.labels}' |
| kubectl-axi | diagnose_endpoints | 2 | policy_violation | command used forbidden tooling: kubectl get svc web -n fault-endpoints -o yaml |
| kubectl-axi | diagnose_readiness | 5 | policy_violation | command used forbidden tooling: kubectl get pod frontend-78db8fc954-wr797 -n fault-readiness -o yaml |
