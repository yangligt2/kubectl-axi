import { DESCRIPTION, TOP_HELP } from "./cli.js";

// Trigger string agents match against to auto-load the skill. Terse and
// outcome-focused so it fires on "something is broken in Kubernetes" intents.
export const SKILL_DESCRIPTION =
  "Troubleshoot Kubernetes through the kubectl-axi CLI - one-call cluster triage, pod diagnosis, " +
  "container logs, events, deployments, nodes, and service/endpoint checks, all read-only. " +
  "Use whenever a task involves Kubernetes workloads misbehaving: pods crashing or pending, " +
  "rollouts stuck, services unreachable, probes failing, OOM kills, image pull errors, or " +
  "any 'why is my app down' investigation against a cluster.";

export const SKILL_AUTHOR = "yangligt2";

// Extended frontmatter read by Nous Research's Hermes Agent harness.
// Harnesses that don't know these fields (e.g. Claude Code) ignore them.
export const HERMES_TAGS = [
  "kubernetes",
  "kubectl",
  "troubleshooting",
  "devops",
  "sre",
];
export const HERMES_CATEGORY = "devops";

function yamlDoubleQuote(value: string): string {
  return JSON.stringify(value);
}

/**
 * Extract the `commands[N]:` block from the top-level help so the skill's
 * command list can never drift from what `kubectl-axi --help` prints.
 */
export function extractCommandsBlock(): string {
  const match = TOP_HELP.match(/^(commands\[\d+\]:\n(?: {2}.*\n)+)/m);
  if (!match) {
    throw new Error("Could not find commands block in TOP_HELP");
  }
  return match[1].trimEnd();
}

/**
 * Render the installable SKILL.md. The body is built from the same shared
 * guidance the CLI prints (description and top-level help), rewriting
 * invocations to non-interactive `npx -y kubectl-axi ...` so the CLI comes
 * along on demand.
 */
export function createSkillMarkdown(): string {
  return `---
name: kubectl-axi
description: ${yamlDoubleQuote(SKILL_DESCRIPTION)}
user-invocable: false
author: ${SKILL_AUTHOR}
metadata:
  hermes:
    tags: [${HERMES_TAGS.join(", ")}]
    category: ${HERMES_CATEGORY}
---

# kubectl-axi

${DESCRIPTION}

You do not need kubectl-axi installed globally - invoke it with \`npx -y kubectl-axi <command>\`.
If kubectl-axi output shows a follow-up command starting with \`kubectl-axi\`, run it as \`npx -y kubectl-axi ...\` instead.

kubectl-axi requires \`kubectl\` on PATH with a working kubeconfig; it inherits whatever cluster access kubectl already has and adds no auth of its own.
It is **read-only**: it cannot mutate or break the cluster. For mutations (restart, scale, delete) or resources it does not cover, fall back to raw \`kubectl\`.

## When to use

Use kubectl-axi whenever a task involves diagnosing Kubernetes state: pods crashing, pending, or restarting; rollouts stuck; services returning errors or having no backends; probes failing; OOM kills; image pull failures; node pressure; or a general "what is broken in this cluster" sweep.

## Workflow

1. Start wide: \`npx -y kubectl-axi triage\` scans the whole cluster in one call - not-ready pods, stuck rollouts (including ones still serving old replicas), pending PVCs, services with zero ready endpoints, node pressure, and the last hour of warning events.
2. Drill into a pod: \`pods view <name> -n <ns>\` replaces \`describe pod\` + \`get events\` - container states, last termination reasons (OOMKilled, exit codes), readiness probe targets, and the pod's events, in one call.
3. Read logs: \`logs <pod> -n <ns>\` tails 100 lines. After crashes, follow the printed \`--previous\` hint to see the run before the last restart. Multi-container pods produce an error that names the failing container - run the suggested command.
4. Check a service: \`svc view <name> -n <ns>\` compares the selector against matching pods and live endpoints, and states the diagnosis (selector mismatch vs unready backends) directly.
5. Scope flags go AFTER the command: \`-n <ns>\`, \`-A\` (lists only), \`--context <name>\`, e.g. \`npx -y kubectl-axi pods -A --context staging\`.
6. Every list sorts broken items first and every response ends with next-step hints under \`help:\` - follow them.

## Commands

\`\`\`
${extractCommandsBlock()}
\`\`\`

Installed copies also inherit the SDK built-in \`update\` command.
Run \`npx -y kubectl-axi --help\` for global flags, or \`npx -y kubectl-axi <command> --help\` for per-command usage.

## Tips

- Output is TOON-encoded and token-efficient; counts and not-ready totals are precomputed in the first line.
- Empty results are definitive ("none found in namespace x"); a nonexistent namespace is reported as NOT_FOUND, not as an empty list.
- \`events\` is sorted newest-first (unlike raw \`kubectl get events\`), and \`--warnings\` filters to problems.
- \`deploy\` catches rollouts stuck at full replica count via the Progressing condition - do not trust READY columns alone.
- \`logs\` caps output at 20,000 chars and reports the total size; raise \`--tail\` only when needed.
- Everything is read-only; you cannot break the cluster with this tool.
`;
}
