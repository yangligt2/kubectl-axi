import { encode } from "@toon-format/toon";
import type { KubeContext } from "../context.js";
import { describeScope } from "../context.js";
import { kubectlJson } from "../kubectl.js";
import { validateFlags } from "../args.js";
import { truncate } from "../format.js";
import { formatRelativeTime, renderHelp, renderOutput } from "../toon.js";
import { isNotReady, podRestarts, podStatus, type Pod } from "../podstatus.js";
import {
  deploymentHealth,
  endpointCounts,
  nodeIssues,
  pvcPending,
  selectorExpression,
  type Deployment,
  type Endpoints,
  type KubeNode,
  type Pvc,
  type Service,
} from "../workloads.js";
import { eventTimestamp, type EventItem } from "./events.js";

export const TRIAGE_HELP = `usage: kubectl-axi triage [flags]
description: one-call cluster health scan - not-ready pods, stuck rollouts, pending PVCs, selector-less services, node pressure, recent warnings
scope: all namespaces by default; narrow with -n <ns>
global flags: -n/--namespace <ns>, --context <name>
examples:
  kubectl-axi triage
  kubectl-axi triage -n payments
  kubectl-axi triage --context prod-cluster`;

const POD_LIMIT = 30;
const WARNING_LIMIT = 10;
const WARNING_WINDOW_MS = 60 * 60 * 1000;

interface List<T> {
  items: T[];
}

export async function triageCommand(
  args: string[],
  ctx?: KubeContext,
): Promise<string> {
  if (args[0] === "--help") return TRIAGE_HELP;

  validateFlags("triage", args, {}, "-n/--namespace, --context");

  // Triage is cluster-wide by default: that is the command's entire point.
  const scoped: KubeContext = {
    context: ctx?.context,
    namespace: ctx?.namespace,
    allNamespaces: !ctx?.namespace,
  };
  const clusterScoped: KubeContext = {
    context: ctx?.context,
    allNamespaces: false,
  };

  // One turn, seven parallel reads. Failed checks degrade to a notice
  // instead of failing the whole triage (no silent skips).
  const [pods, deploys, pvcs, services, endpoints, nodes, events] =
    await Promise.all([
      kubectlJson<List<Pod>>(["get", "pods", "-o", "json"], scoped).catch(
        () => null,
      ),
      kubectlJson<List<Deployment>>(
        ["get", "deployments", "-o", "json"],
        scoped,
      ).catch(() => null),
      kubectlJson<List<Pvc>>(["get", "pvc", "-o", "json"], scoped).catch(
        () => null,
      ),
      kubectlJson<List<Service>>(
        ["get", "services", "-o", "json"],
        scoped,
      ).catch(() => null),
      kubectlJson<List<Endpoints>>(
        ["get", "endpoints", "-o", "json"],
        scoped,
      ).catch(() => null),
      kubectlJson<List<KubeNode>>(
        ["get", "nodes", "-o", "json"],
        clusterScoped,
      ).catch(() => null),
      kubectlJson<List<EventItem>>(
        ["get", "events", "-o", "json"],
        scoped,
      ).catch(() => null),
    ]);

  const blocks: string[] = [];
  const skipped: string[] = [];
  let issueCount = 0;

  // Not-ready pods
  if (pods) {
    const notReady = (pods.items ?? []).filter((pod) => isNotReady(pod));
    issueCount += notReady.length;
    if (notReady.length > 0) {
      const rows = notReady
        .sort((a, b) =>
          `${a.metadata.namespace}/${a.metadata.name}`.localeCompare(
            `${b.metadata.namespace}/${b.metadata.name}`,
          ),
        )
        .slice(0, POD_LIMIT)
        .map((pod) => ({
          namespace: pod.metadata.namespace ?? "",
          name: pod.metadata.name,
          status: podStatus(pod),
          restarts: podRestarts(pod),
        }));
      blocks.push(encode({ not_ready_pods: rows }));
      if (notReady.length > POD_LIMIT) {
        blocks.push(
          `note: showing first ${POD_LIMIT} of ${notReady.length} not-ready pods`,
        );
      }
    }
  } else {
    skipped.push("pods");
  }

  // Stuck / degraded rollouts
  if (deploys) {
    const broken = (deploys.items ?? [])
      .map((d) => ({ deploy: d, health: deploymentHealth(d) }))
      .filter(({ health }) => !health.healthy);
    issueCount += broken.length;
    if (broken.length > 0) {
      blocks.push(
        encode({
          degraded_deployments: broken.map(({ deploy, health }) => ({
            namespace: deploy.metadata.namespace ?? "",
            name: deploy.metadata.name,
            ready: health.ready,
            reason: health.reason,
          })),
        }),
      );
    }
  } else {
    skipped.push("deployments");
  }

  // Pending PVCs
  if (pvcs) {
    const pending = (pvcs.items ?? []).filter((pvc) => pvcPending(pvc));
    issueCount += pending.length;
    if (pending.length > 0) {
      blocks.push(
        encode({
          pending_pvcs: pending.map((pvc) => ({
            namespace: pvc.metadata.namespace ?? "",
            name: pvc.metadata.name,
            phase: pvc.status?.phase ?? "Pending",
            storageclass: pvc.spec?.storageClassName ?? "(default)",
          })),
        }),
      );
    }
  } else {
    skipped.push("pvcs");
  }

  // Selector services with zero ready endpoints
  if (services && endpoints) {
    const endpointsByKey = new Map(
      (endpoints.items ?? []).map((ep) => [
        `${ep.metadata.namespace}/${ep.metadata.name}`,
        ep,
      ]),
    );
    const noEndpoints = (services.items ?? []).filter((svc) => {
      if (!selectorExpression(svc.spec?.selector)) {
        return false; // no selector -> endpoints are managed externally
      }
      const counts = endpointCounts(
        endpointsByKey.get(`${svc.metadata.namespace}/${svc.metadata.name}`),
      );
      return counts.ready === 0;
    });
    issueCount += noEndpoints.length;
    if (noEndpoints.length > 0) {
      blocks.push(
        encode({
          services_without_endpoints: noEndpoints.map((svc) => ({
            namespace: svc.metadata.namespace ?? "",
            name: svc.metadata.name,
            selector: selectorExpression(svc.spec?.selector) ?? "",
          })),
        }),
      );
    }
  } else {
    skipped.push("service endpoints");
  }

  // Node pressure / readiness
  if (nodes) {
    const rows = (nodes.items ?? []).flatMap((node) =>
      nodeIssues(node).map((issue) => ({
        node: node.metadata.name,
        condition: issue.condition,
        status: issue.status,
        message: truncate(issue.message, 100),
      })),
    );
    issueCount += rows.length;
    if (rows.length > 0) {
      blocks.push(encode({ node_issues: rows }));
    }
  } else {
    skipped.push("nodes");
  }

  // Recent warning events - supporting evidence, not counted as issues
  if (events) {
    const cutoff = Date.now() - WARNING_WINDOW_MS;
    const warnings = (events.items ?? [])
      .filter((e) => e.type === "Warning")
      .filter((e) => new Date(eventTimestamp(e) ?? 0).getTime() >= cutoff)
      .sort(
        (a, b) =>
          new Date(eventTimestamp(b) ?? 0).getTime() -
          new Date(eventTimestamp(a) ?? 0).getTime(),
      );
    if (warnings.length > 0) {
      const rows = warnings.slice(0, WARNING_LIMIT).map((e) => ({
        time: formatRelativeTime(eventTimestamp(e)),
        namespace: e.involvedObject?.namespace ?? e.metadata?.namespace ?? "",
        reason: e.reason ?? "",
        object: `${(e.involvedObject?.kind ?? "?").toLowerCase()}/${e.involvedObject?.name ?? "?"}`,
        count: e.count ?? 1,
        message: truncate((e.message ?? "").replace(/\s+/g, " ").trim(), 120),
      }));
      blocks.push(encode({ recent_warnings: rows }));
      if (warnings.length > WARNING_LIMIT) {
        blocks.push(
          `note: showing newest ${WARNING_LIMIT} of ${warnings.length} warnings in the last hour`,
        );
      }
    }
  } else {
    skipped.push("events");
  }

  const scope = describeScope(scoped);
  const headline =
    issueCount === 0
      ? `triage: no issues found in ${scope} - pods, rollouts, PVCs, service endpoints, and nodes are healthy`
      : `triage: ${issueCount} issue${issueCount === 1 ? "" : "s"} found in ${scope}`;

  if (skipped.length > 0) {
    blocks.push(`note: checks skipped (query failed): ${skipped.join(", ")}`);
  }

  const ctxFlag = ctx?.context ? ` --context ${ctx.context}` : "";
  const suggestions =
    issueCount > 0
      ? [
          `Run \`kubectl-axi pods view <name> -n <ns>${ctxFlag}\` to diagnose a not-ready pod`,
          `Run \`kubectl-axi logs <pod> -n <ns>${ctxFlag}\` (add --previous after crashes) for container output`,
        ]
      : [];

  return renderOutput([headline, ...blocks, renderHelp(suggestions)]);
}
