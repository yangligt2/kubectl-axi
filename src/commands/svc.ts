import { encode } from "@toon-format/toon";
import type { KubeContext } from "../context.js";
import { describeScope } from "../context.js";
import { kubectlJson } from "../kubectl.js";
import { AxiError } from "../errors.js";
import { getPositional, validateFlags } from "../args.js";
import { formatEmptyLine } from "../format.js";
import { renderError, renderHelp, renderOutput } from "../toon.js";
import { isNotReady, podStatus, type Pod } from "../podstatus.js";
import {
  endpointCounts,
  portSummary,
  selectorExpression,
  type Endpoints,
  type Service,
} from "../workloads.js";

export const SVC_HELP = `usage: kubectl-axi svc [list|view <name>] [flags]
subcommands[2]:
  (none)/list=list services with live endpoint readiness, view <name>=selector vs matching pods vs endpoints (diagnoses zero-endpoint services)
global flags: -n/--namespace <ns>, -A/--all-namespaces (list only), --context <name>
examples:
  kubectl-axi svc
  kubectl-axi svc -A
  kubectl-axi svc view web -n payments`;

interface ServiceList {
  items: Service[];
}

interface EndpointsList {
  items: Endpoints[];
}

interface PodList {
  items: Pod[];
}

async function listSvcs(args: string[], ctx?: KubeContext): Promise<string> {
  validateFlags("svc list", args, {}, "-n/--namespace, -A/--all-namespaces, --context");

  // Endpoints fetched alongside services so readiness is inline (AXI P4) -
  // "service exists" and "service has backends" answered in one call.
  const [services, endpoints] = await Promise.all([
    kubectlJson<ServiceList>(["get", "services", "-o", "json"], ctx),
    kubectlJson<EndpointsList>(["get", "endpoints", "-o", "json"], ctx).catch(
      () => ({ items: [] }) as EndpointsList,
    ),
  ]);
  const svcs = services.items ?? [];

  if (svcs.length === 0) {
    return renderOutput([formatEmptyLine("services", describeScope(ctx))]);
  }

  const endpointsByKey = new Map(
    (endpoints.items ?? []).map((ep) => [
      `${ep.metadata.namespace}/${ep.metadata.name}`,
      ep,
    ]),
  );

  const rows = svcs.map((svc) => {
    const selector = selectorExpression(svc.spec?.selector);
    const counts = endpointCounts(
      endpointsByKey.get(`${svc.metadata.namespace}/${svc.metadata.name}`),
    );
    const backends = !selector
      ? "external"
      : counts.ready > 0
        ? `${counts.ready} ready`
        : counts.notReady > 0
          ? `0 ready (${counts.notReady} not ready)`
          : "NONE";
    return {
      name: svc.metadata.name,
      ...(ctx?.allNamespaces ? { namespace: svc.metadata.namespace ?? "" } : {}),
      type: svc.spec?.type ?? "ClusterIP",
      ports: portSummary(svc),
      backends,
    };
  });

  const broken = rows.filter((r) => r.backends === "NONE" || r.backends.startsWith("0 ready"));
  const sorted = [...rows].sort((a, b) => {
    const aBroken = broken.includes(a);
    const bBroken = broken.includes(b);
    if (aBroken !== bBroken) {
      return aBroken ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  const countLine =
    broken.length > 0
      ? `count: ${svcs.length} in ${describeScope(ctx)} (${broken.length} without ready backends)`
      : `count: ${svcs.length} in ${describeScope(ctx)}`;

  const suggestions =
    broken.length > 0
      ? [
          `Run \`kubectl-axi svc view <name>${ctx?.namespace ? ` -n ${ctx.namespace}` : " -n <ns>"}${ctx?.context ? ` --context ${ctx.context}` : ""}\` to compare selector vs pod labels`,
        ]
      : [];

  return renderOutput([countLine, encode({ services: sorted }), renderHelp(suggestions)]);
}

async function viewSvc(args: string[], ctx?: KubeContext): Promise<string> {
  if (ctx?.allNamespaces) {
    throw new AxiError(
      "svc view targets a single service; -A/--all-namespaces is not valid here",
      "VALIDATION_ERROR",
      ["Pass the namespace instead: `kubectl-axi svc view <name> -n <ns>`"],
    );
  }
  const name = getPositional(args, 1);
  if (!name) {
    throw new AxiError(
      "Service name is required: kubectl-axi svc view <name>",
      "VALIDATION_ERROR",
      ["Run `kubectl-axi svc` to list service names"],
    );
  }
  validateFlags("svc view", args, {}, "-n/--namespace, --context");

  const svc = await kubectlJson<Service>(
    ["get", "service", name, "-o", "json"],
    ctx,
  );
  const selector = selectorExpression(svc.spec?.selector);

  const [endpoints, matchingPods] = await Promise.all([
    kubectlJson<Endpoints>(["get", "endpoints", name, "-o", "json"], ctx).catch(
      () => undefined,
    ),
    selector
      ? kubectlJson<PodList>(
          ["get", "pods", "-l", selector, "-o", "json"],
          ctx,
        ).catch(() => ({ items: [] }) as PodList)
      : Promise.resolve({ items: [] } as PodList),
  ]);

  const counts = endpointCounts(endpoints);
  const blocks: string[] = [
    encode({
      service: {
        name: svc.metadata.name,
        namespace: svc.metadata.namespace ?? "",
        type: svc.spec?.type ?? "ClusterIP",
        cluster_ip: svc.spec?.clusterIP ?? "",
        ports: portSummary(svc),
        selector: selector ?? "(none - endpoints managed externally)",
        endpoints_ready: counts.ready,
        endpoints_not_ready: counts.notReady,
      },
    }),
  ];

  const suggestions: string[] = [];
  const nsFlag = svc.metadata.namespace ? ` -n ${svc.metadata.namespace}` : "";
  const ctxFlag = ctx?.context ? ` --context ${ctx.context}` : "";

  if (selector) {
    const pods = matchingPods.items ?? [];
    if (pods.length === 0) {
      blocks.push(
        `diagnosis: selector "${selector}" matches 0 pods - the selector does not match any pod labels in this namespace`,
      );
      // Show the labels that DO exist so the mismatch is nameable in one
      // call, without a raw-kubectl --show-labels fallback.
      const nsPods = await kubectlJson<PodList>(
        ["get", "pods", "-o", "json"],
        ctx,
      ).catch(() => ({ items: [] }) as PodList);
      const labelCounts = new Map<string, number>();
      for (const pod of nsPods.items ?? []) {
        const expr =
          Object.entries(pod.metadata.labels ?? {})
            .map(([key, value]) => `${key}=${value}`)
            .sort()
            .join(",") || "(no labels)";
        labelCounts.set(expr, (labelCounts.get(expr) ?? 0) + 1);
      }
      if (labelCounts.size > 0) {
        blocks.push(
          encode({
            pod_labels_in_namespace: [...labelCounts.entries()].map(
              ([labels, count]) => ({ labels, pods: count }),
            ),
          }),
        );
      } else {
        blocks.push("pod_labels_in_namespace: no pods exist in this namespace");
      }
    } else {
      const rows = pods.map((pod) => ({
        name: pod.metadata.name,
        status: podStatus(pod),
        ready: isNotReady(pod) ? "no" : "yes",
      }));
      blocks.push(encode({ matching_pods: rows }));
      const readyCount = rows.filter((r) => r.ready === "yes").length;
      if (counts.ready === 0 && readyCount === 0) {
        blocks.push(
          `diagnosis: selector matches ${pods.length} pod(s) but none are ready - fix the pods, not the service`,
        );
        suggestions.push(
          `Run \`kubectl-axi pods view ${rows[0].name}${nsFlag}${ctxFlag}\` to diagnose the backing pods`,
        );
      }
    }
  }

  return renderOutput([...blocks, renderHelp(suggestions)]);
}

export async function svcCommand(
  args: string[],
  ctx?: KubeContext,
): Promise<string> {
  const sub = args[0];
  if (sub === "--help") return SVC_HELP;
  if (sub === undefined || sub === "list" || sub.startsWith("-")) {
    return listSvcs(sub === "list" ? args.slice(1) : args, ctx);
  }
  if (sub === "view") {
    return viewSvc(args, ctx);
  }
  return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
    "Available subcommands: list, view <name>",
    `Did you mean \`kubectl-axi svc view ${sub}\`?`,
  ]);
}
