import { encode } from "@toon-format/toon";
import type { KubeContext } from "../context.js";
import { kubectlExec, kubectlJson } from "../kubectl.js";
import { renderHelp, renderOutput } from "../toon.js";
import { getSuggestions } from "../suggestions.js";
import { isNotReady, podRestarts, podStatus, type Pod } from "../podstatus.js";

const NOT_READY_PREVIEW_LIMIT = 5;

interface PodList {
  items: Pod[];
}

/**
 * Home view (AXI P8): live cluster snapshot for the current context and
 * namespace. One pods call; degrades to a definitive "unreachable" line
 * rather than an error so the agent still gets its bearings.
 */
export async function homeCommand(
  _args: string[],
  ctx?: KubeContext,
): Promise<string> {
  const [contextName, namespace] = await Promise.all([
    ctx?.context ??
      kubectlExec(["config", "current-context"])
        .then((s) => s.trim())
        .catch(() => "(no kubeconfig)"),
    ctx?.namespace ??
      kubectlExec([
        "config",
        "view",
        "--minify",
        "--output",
        "jsonpath={..namespace}",
      ])
        .then((s) => s.trim() || "default")
        .catch(() => "default"),
  ]);

  const blocks: string[] = [
    encode({ context: contextName, namespace }),
  ];

  try {
    const list = await kubectlJson<PodList>(["get", "pods", "-o", "json"], ctx);
    const pods = list.items ?? [];
    const notReady = pods.filter((pod) => isNotReady(pod));
    blocks.push(`pods: ${pods.length} total, ${notReady.length} not ready`);

    if (notReady.length > 0) {
      blocks.push(
        encode({
          not_ready: notReady.slice(0, NOT_READY_PREVIEW_LIMIT).map((pod) => ({
            name: pod.metadata.name,
            status: podStatus(pod),
            restarts: podRestarts(pod),
          })),
        }),
      );
    }
  } catch {
    blocks.push(
      `pods: unavailable (cluster unreachable via context ${contextName})`,
    );
  }

  blocks.push(renderHelp(getSuggestions({ domain: "home", kube: ctx, action: "" })));
  return renderOutput(blocks);
}
