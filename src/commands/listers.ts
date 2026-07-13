import { encode } from "@toon-format/toon";
import type { KubeContext } from "../context.js";
import { describeScope } from "../context.js";
import { kubectlJson } from "../kubectl.js";
import { validateFlags } from "../args.js";
import { formatEmptyLine, truncate } from "../format.js";
import { formatRelativeTime, renderOutput } from "../toon.js";
import { quotaAtLimit, type Quota } from "../workloads.js";

/**
 * Small read-only listers for the objects agents reach for when VERIFYING a
 * diagnosis (missing configmap/secret, exhausted quota). Without these, the
 * confirmation instinct falls back to raw kubectl.
 */

const GLOBALS = "-n/--namespace, -A/--all-namespaces, --context";

interface List<T> {
  items: T[];
}

interface NamedItem {
  metadata: { name: string; namespace?: string; creationTimestamp?: string };
  data?: Record<string, string>;
  type?: string;
}

export const CM_HELP = `usage: kubectl-axi cm [flags]
description: list ConfigMaps with key names - existence checks for pod references
global flags: ${GLOBALS}
examples:
  kubectl-axi cm -n payments
  kubectl-axi cm -A`;

export async function cmCommand(
  args: string[],
  ctx?: KubeContext,
): Promise<string> {
  if (args[0] === "--help") return CM_HELP;
  validateFlags("cm", args, {}, GLOBALS);
  const items =
    (await kubectlJson<List<NamedItem>>(["get", "configmaps", "-o", "json"], ctx))
      .items ?? [];
  if (items.length === 0) {
    return renderOutput([formatEmptyLine("configmaps", describeScope(ctx))]);
  }
  const rows = items.map((c) => ({
    name: c.metadata.name,
    ...(ctx?.allNamespaces ? { namespace: c.metadata.namespace ?? "" } : {}),
    keys: truncate(Object.keys(c.data ?? {}).join(",") || "(empty)", 80),
    age: formatRelativeTime(c.metadata.creationTimestamp).replace(" ago", ""),
  }));
  return renderOutput([
    `count: ${items.length} in ${describeScope(ctx)}`,
    encode({ configmaps: rows }),
  ]);
}

export const SECRET_HELP = `usage: kubectl-axi secret [flags]
description: list Secrets (names, types, key names - values are never shown)
global flags: ${GLOBALS}
examples:
  kubectl-axi secret -n shop-checkout
  kubectl-axi secret -A`;

export async function secretCommand(
  args: string[],
  ctx?: KubeContext,
): Promise<string> {
  if (args[0] === "--help") return SECRET_HELP;
  validateFlags("secret", args, {}, GLOBALS);
  const items =
    (await kubectlJson<List<NamedItem>>(["get", "secrets", "-o", "json"], ctx))
      .items ?? [];
  if (items.length === 0) {
    return renderOutput([formatEmptyLine("secrets", describeScope(ctx))]);
  }
  const rows = items.map((s) => ({
    name: s.metadata.name,
    ...(ctx?.allNamespaces ? { namespace: s.metadata.namespace ?? "" } : {}),
    type: s.type ?? "",
    keys: truncate(Object.keys(s.data ?? {}).join(",") || "(empty)", 80),
    age: formatRelativeTime(s.metadata.creationTimestamp).replace(" ago", ""),
  }));
  return renderOutput([
    `count: ${items.length} in ${describeScope(ctx)} (values are never shown)`,
    encode({ secrets: rows }),
  ]);
}

export const QUOTA_HELP = `usage: kubectl-axi quota [flags]
description: list ResourceQuotas with used vs hard per resource - at-limit quotas silently block pod creation
global flags: ${GLOBALS}
examples:
  kubectl-axi quota -n inventory
  kubectl-axi quota -A`;

export async function quotaCommand(
  args: string[],
  ctx?: KubeContext,
): Promise<string> {
  if (args[0] === "--help") return QUOTA_HELP;
  validateFlags("quota", args, {}, GLOBALS);
  const items =
    (await kubectlJson<List<Quota>>(["get", "resourcequotas", "-o", "json"], ctx))
      .items ?? [];
  if (items.length === 0) {
    return renderOutput([
      `resourcequotas: none found in ${describeScope(ctx)} - quotas are not limiting anything here`,
    ]);
  }
  const rows = items.flatMap((q) =>
    Object.keys(q.status?.hard ?? {}).map((resource) => {
      const hard = q.status?.hard?.[resource] ?? "";
      const used = q.status?.used?.[resource] ?? "0";
      return {
        name: q.metadata.name,
        ...(ctx?.allNamespaces ? { namespace: q.metadata.namespace ?? "" } : {}),
        resource,
        used,
        hard,
        at_limit: quotaAtLimit(hard, used) ? "yes" : "no",
      };
    }),
  );
  const atLimit = rows.filter((r) => r.at_limit === "yes").length;
  return renderOutput([
    atLimit > 0
      ? `count: ${items.length} quotas in ${describeScope(ctx)} (${atLimit} resources AT LIMIT - new pods will be rejected)`
      : `count: ${items.length} quotas in ${describeScope(ctx)}, none at limit`,
    encode({ quotas: rows }),
  ]);
}
