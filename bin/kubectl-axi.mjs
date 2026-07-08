#!/usr/bin/env node
// Placeholder release reserving the kubectl-axi package name.
// Structured output on stdout per AXI principle 6; exit 1 because the
// agent's intent cannot be satisfied yet.
console.log(
  [
    "kubectl-axi: placeholder release (0.0.1)",
    "status: under development - this release only reserves the package name",
    "help: Kubernetes troubleshooting for agents is coming; use `kubectl` directly for now",
    "help: see https://github.com/kunchenguid/axi for the AXI project",
  ].join("\n"),
);
process.exit(1);
