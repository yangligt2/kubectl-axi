# Changelog

## [0.0.3](https://github.com/yangligt2/kubectl-axi/compare/kubectl-axi-v0.0.2...kubectl-axi-v0.0.3) (2026-07-20)


### Features

* add pvc command and pod scheduling diagnosis ([7bab52d](https://github.com/yangligt2/kubectl-axi/commit/7bab52dd102d9878503c55d451d4e5dfec8038a5))
* cm/secret/quota listers, node labels in list view; bench fallback-rate metric ([4f90e8a](https://github.com/yangligt2/kubectl-axi/commit/4f90e8a6e306003587a314ae68fec8f6f870c350))
* complete one-call diagnoses for pvc, svc, and probe views ([826dd0a](https://github.com/yangligt2/kubectl-axi/commit/826dd0a9702e611c4ef95ac1267c3b1d8e531a8f))
* prove scheduling and config diagnoses in one call; real Gemini pricing ([01f415a](https://github.com/yangligt2/kubectl-axi/commit/01f415acb6a36e37006897f3c33ba6c51d8bb033))
* quota visibility, env summaries, and port-mismatch diagnosis ([56ed368](https://github.com/yangligt2/kubectl-axi/commit/56ed3687c548796827b87c787b89407e93282027))
* show container resource limits in pods view ([afda118](https://github.com/yangligt2/kubectl-axi/commit/afda11821a03a6d1f93a6d3f9632d18d07cc23dd))


### Bug Fixes

* reconcile fixtures before every bench run; deploy view shows labels ([8e4f6bd](https://github.com/yangligt2/kubectl-axi/commit/8e4f6bda2a37032a3554cccd9116195882ae6c87))

## [0.0.2](https://github.com/yangligt2/kubectl-axi/compare/kubectl-axi-v0.0.1...kubectl-axi-v0.0.2) (2026-07-08)


### Features

* add fault fixtures, bench task spec, and fixture cluster tooling ([1c27211](https://github.com/yangligt2/kubectl-axi/commit/1c27211432fd7c380a2dbcf4c190409a0e43c7f1))
* add skill, session hooks, CI, and release automation ([ce61a02](https://github.com/yangligt2/kubectl-axi/commit/ce61a02249ab5f7f35ed7ab86c433c76953adcc7))
* add triage, logs, events, deploy, nodes, and svc commands ([75bd4bc](https://github.com/yangligt2/kubectl-axi/commit/75bd4bc04f4089ea77e0a97dc0ca58a937643074))
* bootstrap CLI with pods list/view on the axi-sdk-js skeleton ([fd33550](https://github.com/yangligt2/kubectl-axi/commit/fd3355041ace50318d4d73a0dad5d0d16ebfdbe9))
* merge bench cluster context into local ~/.kube/config ([ecfd57c](https://github.com/yangligt2/kubectl-axi/commit/ecfd57cd29dbbf0bf47a798607ad7e93c2d2b6c6))
