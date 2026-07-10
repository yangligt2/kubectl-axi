import { encode } from "@toon-format/toon";
import type { KubeContext } from "../context.js";
import { describeScope } from "../context.js";
import { kubectlJson } from "../kubectl.js";
import { AxiError } from "../errors.js";
import { getPositional, validateFlags } from "../args.js";
import { formatCountLine, formatEmptyLine, truncate } from "../format.js";
import { formatRelativeTime, renderError, renderHelp, renderOutput } from "../toon.js";
import {
  deploymentHealth,
  selectorExpression,
  type Deployment,
} from "../workloads.js";

export const DEPLOY_HELP = `usage: kubectl-axi deploy [list|view <name>] [flags]
subcommands[2]:
  (none)/list=list deployments (degraded sorted first), view <name>=replica counts, conditions, images
global flags: -n/--namespace <ns>, -A/--all-namespaces (list only), --context <name>
examples:
  kubectl-axi deploy
  kubectl-axi deploy -A
  kubectl-axi deploy view checkout -n payments`;

interface DeploymentList {
  items: Deployment[];
}

async function listDeploys(args: string[], ctx?: KubeContext): Promise<string> {
  validateFlags("deploy list", args, {}, "-n/--namespace, -A/--all-namespaces, --context");

  const list = await kubectlJson<DeploymentList>(
    ["get", "deployments", "-o", "json"],
    ctx,
  );
  const deploys = list.items ?? [];

  if (deploys.length === 0) {
    return renderOutput([
      formatEmptyLine("deployments", describeScope(ctx)),
      renderHelp([
        `Run \`kubectl-axi deploy -A${ctx?.context ? ` --context ${ctx.context}` : ""}\` to list deployments across all namespaces`,
      ]),
    ]);
  }

  const withHealth = deploys
    .map((deploy) => ({ deploy, health: deploymentHealth(deploy) }))
    .sort((a, b) => {
      if (a.health.healthy !== b.health.healthy) {
        return a.health.healthy ? 1 : -1;
      }
      return `${a.deploy.metadata.namespace}/${a.deploy.metadata.name}`.localeCompare(
        `${b.deploy.metadata.namespace}/${b.deploy.metadata.name}`,
      );
    });

  const rows = withHealth.map(({ deploy, health }) => ({
    name: deploy.metadata.name,
    ...(ctx?.allNamespaces ? { namespace: deploy.metadata.namespace ?? "" } : {}),
    ready: health.ready,
    status: health.reason,
    age: formatRelativeTime(deploy.metadata.creationTimestamp).replace(" ago", ""),
  }));

  const degraded = withHealth.filter(({ health }) => !health.healthy).length;
  const suggestions = [
    `Run \`kubectl-axi deploy view <name>${ctx?.namespace ? ` -n ${ctx.namespace}` : ctx?.allNamespaces ? " -n <ns>" : ""}${ctx?.context ? ` --context ${ctx.context}` : ""}\` for conditions and images`,
  ];

  return renderOutput([
    formatCountLine({
      count: deploys.length,
      notReady: degraded,
      scope: describeScope(ctx),
    }).replace("not ready", "degraded"),
    encode({ deployments: rows }),
    renderHelp(suggestions),
  ]);
}

async function viewDeploy(args: string[], ctx?: KubeContext): Promise<string> {
  if (ctx?.allNamespaces) {
    throw new AxiError(
      "deploy view targets a single deployment; -A/--all-namespaces is not valid here",
      "VALIDATION_ERROR",
      ["Pass the namespace instead: `kubectl-axi deploy view <name> -n <ns>`"],
    );
  }
  const name = getPositional(args, 1);
  if (!name) {
    throw new AxiError(
      "Deployment name is required: kubectl-axi deploy view <name>",
      "VALIDATION_ERROR",
      ["Run `kubectl-axi deploy` to list deployment names"],
    );
  }
  validateFlags("deploy view", args, {}, "-n/--namespace, --context");

  const deploy = await kubectlJson<Deployment>(
    ["get", "deployment", name, "-o", "json"],
    ctx,
  );
  const health = deploymentHealth(deploy);
  const status = deploy.status ?? {};

  const blocks: string[] = [
    encode({
      deployment: {
        name: deploy.metadata.name,
        namespace: deploy.metadata.namespace ?? "",
        status: health.reason,
        desired: deploy.spec?.replicas ?? 1,
        ready: status.readyReplicas ?? 0,
        up_to_date: status.updatedReplicas ?? 0,
        available: status.availableReplicas ?? 0,
        age: formatRelativeTime(deploy.metadata.creationTimestamp).replace(" ago", ""),
        images: (deploy.spec?.template?.spec?.containers ?? [])
          .map((c) => c.image ?? "")
          .join(","),
        // Selector and template labels together let selector/label
        // mismatches (deployment vs service) be diagnosed in one call.
        selector: selectorExpression(deploy.spec?.selector?.matchLabels) ?? "none",
        pod_labels:
          selectorExpression(deploy.spec?.template?.metadata?.labels) ?? "none",
      },
    }),
  ];

  const conditions = (status.conditions ?? []).map((c) => ({
    type: c.type,
    status: c.status,
    reason: c.reason ?? "",
    message: truncate((c.message ?? "").replace(/\s+/g, " ").trim(), 140),
  }));
  if (conditions.length > 0) {
    blocks.push(encode({ conditions }));
  }

  const nsFlag = deploy.metadata.namespace ? ` -n ${deploy.metadata.namespace}` : "";
  const ctxFlag = ctx?.context ? ` --context ${ctx.context}` : "";
  const suggestions = health.healthy
    ? []
    : [
        `Run \`kubectl-axi pods${nsFlag}${ctxFlag}\` to see this deployment's pods (not-ready sorted first)`,
      ];

  return renderOutput([...blocks, renderHelp(suggestions)]);
}

export async function deployCommand(
  args: string[],
  ctx?: KubeContext,
): Promise<string> {
  const sub = args[0];
  if (sub === "--help") return DEPLOY_HELP;
  if (sub === undefined || sub === "list" || sub.startsWith("-")) {
    return listDeploys(sub === "list" ? args.slice(1) : args, ctx);
  }
  if (sub === "view") {
    return viewDeploy(args, ctx);
  }
  return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
    "Available subcommands: list, view <name>",
    `Did you mean \`kubectl-axi deploy view ${sub}\`?`,
  ]);
}
