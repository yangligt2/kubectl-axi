import { encode } from "@toon-format/toon";
import type { KubeContext } from "../context.js";
import { describeScope } from "../context.js";
import { kubectlExec, kubectlJson, kubectlRaw } from "../kubectl.js";
import { AxiError } from "../errors.js";
import { getPositional, validateFlags } from "../args.js";
import { formatCountLine, formatEmptyLine, truncate } from "../format.js";
import { renderError, renderHelp, renderOutput, formatRelativeTime } from "../toon.js";
import { getSuggestions } from "../suggestions.js";
import {
  containerStateString,
  isNotReady,
  lastStateString,
  limitsSummary,
  nodeSelectorExpression,
  podReady,
  podRestarts,
  podStatus,
  probeSummary,
  referencedConfig,
  unschedulableMessage,
  type ContainerStatus,
  type Pod,
} from "../podstatus.js";

export const PODS_HELP = `usage: kubectl-axi pods [list|view <name>] [flags]
subcommands[2]:
  (none)/list=list pods (not-ready sorted first), view <name>=pod autopsy: containers, probes, recent events
global flags (accepted by every command, stripped before validation):
  -n/--namespace <ns>, -A/--all-namespaces (list only), --context <name>
flags{list}: globals only
flags{view}: globals only (-A not valid; view targets one pod)
examples:
  kubectl-axi pods
  kubectl-axi pods -A
  kubectl-axi pods -n payments
  kubectl-axi pods view checkout-58fd7b6c5-x2k4j -n payments`;

interface PodList {
  items: Pod[];
}

interface EventItem {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  lastTimestamp?: string;
  eventTime?: string;
  metadata?: { creationTimestamp?: string };
}

interface EventList {
  items: EventItem[];
}

const GLOBAL_FLAGS_SUMMARY = "-n/--namespace, -A/--all-namespaces, --context";

async function listPods(args: string[], ctx?: KubeContext): Promise<string> {
  validateFlags("pods list", args, {}, GLOBAL_FLAGS_SUMMARY);

  const list = await kubectlJson<PodList>(["get", "pods", "-o", "json"], ctx);
  const pods = list.items ?? [];

  if (pods.length === 0) {
    // kubectl returns an empty list (exit 0) for a namespace that does not
    // exist; distinguish that from a genuinely empty namespace (AXI P5).
    await assertNamespaceExists(ctx);
    const scope = await resolveScopeName(ctx);
    const suggestions = getSuggestions({
      domain: "pods",
      action: "list",
      isEmpty: true,
      kube: ctx,
    });
    return renderOutput([
      formatEmptyLine("pods", scope),
      renderHelp(suggestions),
    ]);
  }

  const showNamespace = ctx?.allNamespaces === true;
  const rows = pods
    .map((pod) => ({
      pod,
      notReady: isNotReady(pod),
    }))
    .sort((a, b) => {
      if (a.notReady !== b.notReady) {
        return a.notReady ? -1 : 1;
      }
      const nsCompare = (a.pod.metadata.namespace ?? "").localeCompare(
        b.pod.metadata.namespace ?? "",
      );
      if (nsCompare !== 0) {
        return nsCompare;
      }
      return a.pod.metadata.name.localeCompare(b.pod.metadata.name);
    })
    .map(({ pod }) => ({
      name: pod.metadata.name,
      ...(showNamespace ? { namespace: pod.metadata.namespace ?? "" } : {}),
      ready: podReady(pod),
      status: podStatus(pod),
      restarts: podRestarts(pod),
      age: formatRelativeTime(pod.metadata.creationTimestamp).replace(
        " ago",
        "",
      ),
    }));

  const notReadyCount = pods.filter((pod) => isNotReady(pod)).length;
  const suggestions = getSuggestions({
    domain: "pods",
    action: "list",
    hasNotReady: notReadyCount > 0,
    kube: ctx,
  });

  return renderOutput([
    formatCountLine({
      count: pods.length,
      notReady: notReadyCount,
      scope: describeScope(ctx),
    }),
    encode({ pods: rows }),
    renderHelp(suggestions),
  ]);
}

async function viewPod(args: string[], ctx?: KubeContext): Promise<string> {
  if (ctx?.allNamespaces) {
    throw new AxiError(
      "pods view targets a single pod; -A/--all-namespaces is not valid here",
      "VALIDATION_ERROR",
      ["Pass the pod's namespace instead: `kubectl-axi pods view <name> -n <ns>`"],
    );
  }

  const name = getPositional(args, 1);
  if (!name) {
    throw new AxiError(
      "Pod name is required: kubectl-axi pods view <name>",
      "VALIDATION_ERROR",
      ["Run `kubectl-axi pods` to list pod names"],
    );
  }
  validateFlags("pods view", args, {}, "-n/--namespace, --context");

  const [pod, events] = await Promise.all([
    kubectlJson<Pod>(["get", "pod", name, "-o", "json"], ctx),
    kubectlJson<EventList>(
      [
        "get",
        "events",
        "-o",
        "json",
        "--field-selector",
        `involvedObject.name=${name},involvedObject.kind=Pod`,
      ],
      ctx,
    ).catch(() => ({ items: [] }) as EventList),
  ]);

  const blocks: string[] = [];

  blocks.push(
    encode({
      pod: {
        name: pod.metadata.name,
        namespace: pod.metadata.namespace ?? "",
        status: podStatus(pod),
        ready: podReady(pod),
        restarts: podRestarts(pod),
        age: formatRelativeTime(pod.metadata.creationTimestamp).replace(
          " ago",
          "",
        ),
        node: pod.spec?.nodeName ?? "unscheduled",
      },
    }),
  );

  // Scheduling block: only meaningful when the pod can't be placed. Surfaces
  // the scheduler's message AND the pod's own nodeSelector so the agent can
  // see which constraint failed without hunting for the spec.
  const unschedulable = unschedulableMessage(pod);
  if (unschedulable) {
    const selector = nodeSelectorExpression(pod);
    // Count nodes satisfying the selector so "no node carries this label"
    // is proven here, not via a raw `kubectl get nodes --show-labels`.
    let matchingNodes: number | null = null;
    if (selector) {
      matchingNodes = await kubectlExec(
        ["get", "nodes", "-l", selector, "-o", "name"],
        ctx?.context ? { context: ctx.context, allNamespaces: false } : undefined,
      )
        .then((out) => (out.trim() ? out.trim().split("\n").length : 0))
        .catch(() => null);
    }
    blocks.push(
      encode({
        scheduling: {
          reason: unschedulable,
          node_selector: selector ?? "none",
          ...(matchingNodes !== null
            ? { nodes_matching_selector: matchingNodes }
            : {}),
          tolerations: (pod.spec?.tolerations ?? [])
            .map((t) => t.key ?? "*")
            .join(",") || "none",
        },
      }),
    );
  }

  const initStatuses = pod.status?.initContainerStatuses ?? [];
  if (initStatuses.length > 0) {
    blocks.push(
      encode({
        init_containers: initStatuses.map((s) => ({
          name: s.name,
          state: containerStateString(s),
          restarts: s.restartCount ?? 0,
          last_state: lastStateString(s),
        })),
      }),
    );
  }

  const containerSpecs = pod.spec?.containers ?? [];
  const statusByName = new Map<string, ContainerStatus>(
    (pod.status?.containerStatuses ?? []).map((s) => [s.name, s]),
  );
  blocks.push(
    encode({
      containers: containerSpecs.map((spec) => {
        const status = statusByName.get(spec.name);
        return {
          name: spec.name,
          image: spec.image ?? status?.image ?? "",
          state: status ? containerStateString(status) : "not created",
          ready: status?.ready ? "yes" : "no",
          restarts: status?.restartCount ?? 0,
          last_state: status ? lastStateString(status) : "none",
          // Declared ports sit next to the probe target so port/probe
          // mismatches are visible without pulling the deployment spec.
          ports:
            (spec.ports ?? [])
              .map((p) => p.containerPort)
              .filter((p) => p !== undefined)
              .join(",") || "none",
          readiness: probeSummary(spec),
          limits: limitsSummary(spec),
        };
      }),
    }),
  );

  // CreateContainerConfigError means a referenced ConfigMap/Secret is bad;
  // cross-check existence so the diagnosis is definitive in this one call
  // (same pattern as pvc view's storage-class check).
  const hasConfigError = [
    ...initStatuses,
    ...(pod.status?.containerStatuses ?? []),
  ].some((s) => s.state?.waiting?.reason === "CreateContainerConfigError");
  if (hasConfigError) {
    const refs = referencedConfig(pod);
    const checks = await Promise.all([
      ...refs.configmaps.map(async (name) => ({
        kind: "configmap",
        name,
        ok: (await kubectlRaw(["get", "configmap", name], ctx)).exitCode === 0,
      })),
      ...refs.secrets.map(async (name) => ({
        kind: "secret",
        name,
        ok: (await kubectlRaw(["get", "secret", name], ctx)).exitCode === 0,
      })),
    ]);
    const missing = checks.filter((c) => !c.ok);
    if (missing.length > 0) {
      blocks.push(
        `diagnosis: ${missing.map((m) => `${m.kind} "${m.name}"`).join(", ")} referenced by this pod does not exist in namespace ${pod.metadata.namespace ?? "default"}`,
      );
    }
  }

  const eventRows = (events.items ?? [])
    .map((e) => ({
      time: e.lastTimestamp ?? e.eventTime ?? e.metadata?.creationTimestamp,
      type: e.type ?? "Normal",
      reason: e.reason ?? "",
      count: e.count ?? 1,
      message: truncate((e.message ?? "").replace(/\s+/g, " ").trim(), 140),
    }))
    .sort(
      (a, b) =>
        new Date(b.time ?? 0).getTime() - new Date(a.time ?? 0).getTime(),
    )
    .slice(0, 10)
    .map((e) => ({ ...e, time: formatRelativeTime(e.time) }));

  if (eventRows.length > 0) {
    blocks.push(encode({ events: eventRows }));
  } else {
    blocks.push("events: none recorded for this pod");
  }

  // Natural next step after a broken pod: its logs - with the container
  // name filled in so the suggestion runs as-is (AXI P9).
  const allStatuses = [
    ...initStatuses,
    ...(pod.status?.containerStatuses ?? []),
  ];
  const broken = allStatuses.find(
    (s) => (s.restartCount ?? 0) > 0 || s.state?.waiting !== undefined,
  );
  if (broken) {
    const nsFlag = pod.metadata.namespace ? ` -n ${pod.metadata.namespace}` : "";
    const ctxFlag = ctx?.context ? ` --context ${ctx.context}` : "";
    const previousHint = (broken.restartCount ?? 0) > 0 ? " (add --previous for the run before the last restart)" : "";
    blocks.push(
      renderHelp([
        `Run \`kubectl-axi logs ${pod.metadata.name} -c ${broken.name}${nsFlag}${ctxFlag}\` to see why ${broken.name} is failing${previousHint}`,
      ]),
    );
  }

  return renderOutput(blocks);
}

/** Turn "empty because the namespace does not exist" into a definitive error. */
async function assertNamespaceExists(ctx?: KubeContext): Promise<void> {
  if (!ctx?.namespace) {
    return;
  }
  const check = await kubectlRaw(
    ["get", "namespace", ctx.namespace],
    ctx.context ? { context: ctx.context, allNamespaces: false } : undefined,
  );
  if (check.exitCode !== 0 && /not found/i.test(check.stderr)) {
    throw new AxiError(`Namespace "${ctx.namespace}" not found`, "NOT_FOUND", [
      "Run `kubectl-axi pods -A` to list pods across existing namespaces",
    ]);
  }
}

/** Best-effort name for "the current namespace" in empty states. */
async function resolveScopeName(ctx?: KubeContext): Promise<string> {
  if (ctx?.allNamespaces || ctx?.namespace) {
    return describeScope(ctx);
  }
  try {
    const ns = (
      await kubectlExec(
        ["config", "view", "--minify", "--output", "jsonpath={..namespace}"],
        ctx?.context ? { context: ctx.context, allNamespaces: false } : undefined,
      )
    ).trim();
    return `namespace ${ns || "default"} (current)`;
  } catch {
    return describeScope(ctx);
  }
}

export async function podsCommand(
  args: string[],
  ctx?: KubeContext,
): Promise<string> {
  const sub = args[0];

  if (sub === "--help") return PODS_HELP;
  if (sub === undefined || sub === "list" || sub.startsWith("-")) {
    return listPods(sub === "list" ? args.slice(1) : args, ctx);
  }
  if (sub === "view") {
    return viewPod(args, ctx);
  }

  return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
    "Available subcommands: list, view <name>",
    `Did you mean \`kubectl-axi pods view ${sub}\`?`,
  ]);
}
