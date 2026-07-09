import { encode } from "@toon-format/toon";
import type { KubeContext } from "../context.js";
import { describeScope } from "../context.js";
import { kubectlJson, kubectlRaw } from "../kubectl.js";
import { AxiError } from "../errors.js";
import { getPositional, validateFlags } from "../args.js";
import { formatCountLine, formatEmptyLine, truncate } from "../format.js";
import { formatRelativeTime, renderError, renderHelp, renderOutput } from "../toon.js";
import { pvcPending, type Pvc } from "../workloads.js";
import type { Pod } from "../podstatus.js";

export const PVC_HELP = `usage: kubectl-axi pvc [list|view <name>] [flags]
subcommands[2]:
  (none)/list=list PVCs (pending first), view <name>=phase, storage class (existence-checked), and mounting pods
global flags: -n/--namespace <ns>, -A/--all-namespaces (list only), --context <name>
examples:
  kubectl-axi pvc
  kubectl-axi pvc -A
  kubectl-axi pvc view data-cache -n payments`;

interface PvcList {
  items: Pvc[];
}

interface PodList {
  items: Pod[];
}

interface StorageClassList {
  items: Array<{ metadata: { name: string } }>;
}

async function listPvcs(args: string[], ctx?: KubeContext): Promise<string> {
  validateFlags("pvc list", args, {}, "-n/--namespace, -A/--all-namespaces, --context");

  const list = await kubectlJson<PvcList>(["get", "pvc", "-o", "json"], ctx);
  const pvcs = list.items ?? [];

  if (pvcs.length === 0) {
    return renderOutput([formatEmptyLine("PVCs", describeScope(ctx))]);
  }

  const rows = pvcs
    .map((pvc) => ({ pvc, pending: pvcPending(pvc) }))
    .sort((a, b) => {
      if (a.pending !== b.pending) return a.pending ? -1 : 1;
      return a.pvc.metadata.name.localeCompare(b.pvc.metadata.name);
    })
    .map(({ pvc }) => ({
      name: pvc.metadata.name,
      ...(ctx?.allNamespaces ? { namespace: pvc.metadata.namespace ?? "" } : {}),
      phase: pvc.status?.phase ?? "Pending",
      storageclass: pvc.spec?.storageClassName ?? "(default)",
      size: pvc.spec?.resources?.requests?.["storage"] ?? "",
    }));

  const pending = pvcs.filter((pvc) => pvcPending(pvc)).length;
  const suggestions =
    pending > 0
      ? [
          `Run \`kubectl-axi pvc view <name>${ctx?.namespace ? ` -n ${ctx.namespace}` : " -n <ns>"}${ctx?.context ? ` --context ${ctx.context}` : ""}\` to see why a PVC is unbound`,
        ]
      : [];

  return renderOutput([
    formatCountLine({
      count: pvcs.length,
      notReady: pending,
      scope: describeScope(ctx),
    }).replace("not ready", "pending"),
    encode({ pvcs: rows }),
    renderHelp(suggestions),
  ]);
}

async function viewPvc(args: string[], ctx?: KubeContext): Promise<string> {
  if (ctx?.allNamespaces) {
    throw new AxiError(
      "pvc view targets a single PVC; -A/--all-namespaces is not valid here",
      "VALIDATION_ERROR",
      ["Pass the namespace instead: `kubectl-axi pvc view <name> -n <ns>`"],
    );
  }
  const name = getPositional(args, 1);
  if (!name) {
    throw new AxiError(
      "PVC name is required: kubectl-axi pvc view <name>",
      "VALIDATION_ERROR",
      ["Run `kubectl-axi pvc` to list PVC names"],
    );
  }
  validateFlags("pvc view", args, {}, "-n/--namespace, --context");

  const pvc = await kubectlJson<Pvc>(["get", "pvc", name, "-o", "json"], ctx);
  const storageClass = pvc.spec?.storageClassName;

  // The classic pending-PVC root cause is a storage class that doesn't exist;
  // cross-check it here so the agent never has to fall back to raw kubectl.
  // Also find which pods mount this PVC (blocked pods trace back here).
  const clusterScope = ctx?.context
    ? { context: ctx.context, allNamespaces: false }
    : undefined;
  const [scExists, pods] = await Promise.all([
    storageClass
      ? kubectlRaw(["get", "storageclass", storageClass], clusterScope).then(
          (r) => r.exitCode === 0,
        )
      : Promise.resolve(true),
    kubectlJson<PodList>(["get", "pods", "-o", "json"], ctx).catch(
      () => ({ items: [] }) as PodList,
    ),
  ]);

  const storageClassNames = storageClass
    ? undefined
    : await kubectlJson<StorageClassList>(
        ["get", "storageclass", "-o", "json"],
        clusterScope,
      )
        .then((l) => (l.items ?? []).map((s) => s.metadata.name))
        .catch(() => [] as string[]);

  const mountingPods = (pods.items ?? [])
    .filter((pod) =>
      (pod as unknown as { spec?: { volumes?: Array<{ persistentVolumeClaim?: { claimName?: string } }> } }).spec?.volumes?.some(
        (v) => v.persistentVolumeClaim?.claimName === name,
      ),
    )
    .map((pod) => pod.metadata.name);

  const blocks: string[] = [
    encode({
      pvc: {
        name: pvc.metadata.name,
        namespace: pvc.metadata.namespace ?? "",
        phase: pvc.status?.phase ?? "Pending",
        storageclass: storageClass ?? "(default)",
        size: pvc.spec?.resources?.requests?.["storage"] ?? "",
        volume: pvc.spec?.volumeName ?? "(unbound)",
        mounted_by: mountingPods.length > 0 ? mountingPods.join(",") : "none",
      },
    }),
  ];

  if (storageClass && !scExists) {
    blocks.push(
      `diagnosis: storage class "${storageClass}" does not exist, so this PVC can never bind${storageClassNames && storageClassNames.length > 0 ? ` (available: ${truncate(storageClassNames.join(","), 120)})` : ""}`,
    );
  }

  const events = await kubectlJson<{ items: Array<Record<string, unknown>> }>(
    [
      "get",
      "events",
      "-o",
      "json",
      "--field-selector",
      `involvedObject.name=${name},involvedObject.kind=PersistentVolumeClaim`,
    ],
    ctx,
  ).catch(() => ({ items: [] }));
  const warningRows = (events.items ?? [])
    .map((e) => e as Record<string, string>)
    .slice(0, 5)
    .map((e) => ({
      time: formatRelativeTime(
        (e.lastTimestamp as string) ?? (e.eventTime as string),
      ),
      reason: e.reason ?? "",
      message: truncate(String(e.message ?? "").replace(/\s+/g, " ").trim(), 120),
    }));
  if (warningRows.length > 0) {
    blocks.push(encode({ events: warningRows }));
  }

  return renderOutput(blocks);
}

export async function pvcCommand(
  args: string[],
  ctx?: KubeContext,
): Promise<string> {
  const sub = args[0];
  if (sub === "--help") return PVC_HELP;
  if (sub === undefined || sub === "list" || sub.startsWith("-")) {
    return listPvcs(sub === "list" ? args.slice(1) : args, ctx);
  }
  if (sub === "view") {
    return viewPvc(args, ctx);
  }
  return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
    "Available subcommands: list, view <name>",
    `Did you mean \`kubectl-axi pvc view ${sub}\`?`,
  ]);
}
