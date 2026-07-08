import type { KubeContext } from "./context.js";

interface SuggestionContext {
  domain: string;
  action: string;
  isEmpty?: boolean;
  hasNotReady?: boolean;
  kube?: KubeContext;
}

type SuggestionEntry = {
  match: (ctx: SuggestionContext) => boolean;
  lines: (ctx: SuggestionContext) => string[];
};

/**
 * Carry the invocation's disambiguating flags into suggestions (AXI P9):
 * a suggested command must work as-is in the same scope.
 */
function scopeFlags(ctx: SuggestionContext): string {
  const kube = ctx.kube;
  let flags = "";
  if (kube?.namespace) {
    flags += ` -n ${kube.namespace}`;
  }
  if (kube?.context) {
    flags += ` --context ${kube.context}`;
  }
  return flags;
}

const table: SuggestionEntry[] = [
  {
    match: (c) => c.domain === "home",
    lines: (c) => [
      `Run \`kubectl-axi pods${scopeFlags(c)}\` to list pods (add -A for all namespaces)`,
      `Run \`kubectl-axi pods view <name> -n <ns>\` to diagnose a pod`,
    ],
  },
  {
    match: (c) =>
      c.domain === "pods" && c.action === "list" && c.isEmpty === true,
    lines: (c) => [
      `Run \`kubectl-axi pods -A${c.kube?.context ? ` --context ${c.kube.context}` : ""}\` to list pods across all namespaces`,
    ],
  },
  {
    match: (c) =>
      c.domain === "pods" && c.action === "list" && c.hasNotReady === true,
    lines: (c) => [
      `Run \`kubectl-axi pods view <name>${viewScopeHint(c)}\` to diagnose a not-ready pod (containers, probes, events)`,
    ],
  },
  {
    match: (c) => c.domain === "pods" && c.action === "list",
    lines: (c) => [
      `Run \`kubectl-axi pods view <name>${viewScopeHint(c)}\` to see containers, probes, and recent events`,
    ],
  },
];

function viewScopeHint(ctx: SuggestionContext): string {
  // In -A listings the namespace varies per pod; use a placeholder.
  if (ctx.kube?.allNamespaces) {
    return ` -n <ns>${ctx.kube?.context ? ` --context ${ctx.kube.context}` : ""}`;
  }
  return scopeFlags(ctx);
}

export function getSuggestions(ctx: SuggestionContext): string[] {
  for (const entry of table) {
    if (entry.match(ctx)) {
      return entry.lines(ctx);
    }
  }
  return [];
}
