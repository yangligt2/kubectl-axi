import { encode } from "@toon-format/toon";
import type { KubeContext } from "../context.js";
import { kubectlJson } from "../kubectl.js";
import { AxiError } from "../errors.js";
import { getPositional, validateFlags } from "../args.js";
import { truncate } from "../format.js";
import { formatRelativeTime, renderError, renderHelp, renderOutput } from "../toon.js";
import { nodeIssues, type KubeNode } from "../workloads.js";

export const NODES_HELP = `usage: kubectl-axi nodes [list|view <name>] [flags]
subcommands[2]:
  (none)/list=list nodes with readiness and pressure, view <name>=conditions, capacity, taints
global flags: --context <name> (nodes are cluster-scoped; -n/-A do not apply)
examples:
  kubectl-axi nodes
  kubectl-axi nodes view worker-1 --context prod`;

interface NodeList {
  items: KubeNode[];
}

function clusterScope(ctx?: KubeContext): KubeContext | undefined {
  if (ctx?.namespace || ctx?.allNamespaces) {
    throw new AxiError(
      "nodes are cluster-scoped; -n/--namespace and -A do not apply",
      "VALIDATION_ERROR",
      ["Re-run without namespace flags: `kubectl-axi nodes`"],
    );
  }
  return ctx?.context ? { context: ctx.context, allNamespaces: false } : undefined;
}

function readiness(node: KubeNode): string {
  const ready = node.status?.conditions?.find((c) => c.type === "Ready");
  return ready?.status === "True" ? "Ready" : "NotReady";
}

function pressureSummary(node: KubeNode): string {
  const issues = nodeIssues(node).filter((i) => i.condition !== "Ready");
  if (issues.length === 0) {
    return "none";
  }
  return issues.map((i) => i.condition).join(",");
}

async function listNodes(args: string[], ctx?: KubeContext): Promise<string> {
  validateFlags("nodes list", args, {}, "--context");
  const scope = clusterScope(ctx);

  const list = await kubectlJson<NodeList>(["get", "nodes", "-o", "json"], scope);
  const nodes = list.items ?? [];

  const rows = nodes
    .map((node) => ({
      name: node.metadata.name,
      status: readiness(node),
      pressure: pressureSummary(node),
      version: node.status?.nodeInfo?.kubeletVersion ?? "",
      age: formatRelativeTime(node.metadata.creationTimestamp).replace(" ago", ""),
    }))
    .sort((a, b) => {
      if ((a.status === "Ready") !== (b.status === "Ready")) {
        return a.status === "Ready" ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    });

  const unhealthy = rows.filter(
    (r) => r.status !== "Ready" || r.pressure !== "none",
  ).length;
  const countLine =
    unhealthy > 0
      ? `count: ${nodes.length} nodes (${unhealthy} with issues)`
      : `count: ${nodes.length} nodes, all healthy`;

  return renderOutput([
    countLine,
    encode({ nodes: rows }),
    renderHelp(
      unhealthy > 0
        ? [
            `Run \`kubectl-axi nodes view <name>${ctx?.context ? ` --context ${ctx.context}` : ""}\` for conditions and capacity`,
          ]
        : [],
    ),
  ]);
}

async function viewNode(args: string[], ctx?: KubeContext): Promise<string> {
  const name = getPositional(args, 1);
  if (!name) {
    throw new AxiError(
      "Node name is required: kubectl-axi nodes view <name>",
      "VALIDATION_ERROR",
      ["Run `kubectl-axi nodes` to list node names"],
    );
  }
  validateFlags("nodes view", args, {}, "--context");
  const scope = clusterScope(ctx);

  const node = await kubectlJson<KubeNode>(
    ["get", "node", name, "-o", "json"],
    scope,
  );

  const blocks: string[] = [
    encode({
      node: {
        name: node.metadata.name,
        status: readiness(node),
        version: node.status?.nodeInfo?.kubeletVersion ?? "",
        age: formatRelativeTime(node.metadata.creationTimestamp).replace(" ago", ""),
        cpu: node.status?.allocatable?.["cpu"] ?? "",
        memory: node.status?.allocatable?.["memory"] ?? "",
        max_pods: node.status?.allocatable?.["pods"] ?? "",
        // Labels answer "which nodeSelectors can this node satisfy" without
        // a raw `kubectl get node --show-labels` fallback.
        labels:
          Object.entries(node.metadata.labels ?? {})
            .map(([key, value]) => `${key}=${value}`)
            .join(",") || "none",
      },
    }),
    encode({
      conditions: (node.status?.conditions ?? []).map((c) => ({
        type: c.type,
        status: c.status,
        reason: c.reason ?? "",
        message: truncate((c.message ?? "").replace(/\s+/g, " ").trim(), 100),
      })),
    }),
  ];

  const taints = node.spec?.taints ?? [];
  blocks.push(
    taints.length > 0
      ? encode({
          taints: taints.map((t) => ({
            key: t.key,
            value: t.value ?? "",
            effect: t.effect,
          })),
        })
      : "taints: none",
  );

  return renderOutput(blocks);
}

export async function nodesCommand(
  args: string[],
  ctx?: KubeContext,
): Promise<string> {
  const sub = args[0];
  if (sub === "--help") return NODES_HELP;
  if (sub === undefined || sub === "list" || sub.startsWith("-")) {
    return listNodes(sub === "list" ? args.slice(1) : args, ctx);
  }
  if (sub === "view") {
    return viewNode(args, ctx);
  }
  return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
    "Available subcommands: list, view <name>",
    `Did you mean \`kubectl-axi nodes view ${sub}\`?`,
  ]);
}
