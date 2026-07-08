import { encode } from "@toon-format/toon";
import type { KubeContext } from "../context.js";
import { kubectlExec } from "../kubectl.js";
import { validateFlags } from "../args.js";
import { renderHelp, renderOutput } from "../toon.js";

export const CTX_HELP = `usage: kubectl-axi ctx
description: current kubectl context and namespace, read from the local kubeconfig only - never calls the cluster
notes: this is what the optional SessionStart hook prints (ambient context must not hang on dead clusters or trigger SSO refresh)
examples:
  kubectl-axi ctx
  kubectl-axi ctx --context prod-cluster`;

/**
 * Kubeconfig-local context snapshot (AXI P7). Zero API calls by design:
 * a session hook that touches the cluster can hang on dead contexts,
 * trigger interactive SSO refresh, and leak cluster state ambiently.
 */
export async function ctxCommand(
  args: string[],
  kctx?: KubeContext,
): Promise<string> {
  if (args[0] === "--help") return CTX_HELP;
  validateFlags("ctx", args, {}, "-n/--namespace, --context");

  const contextScope = kctx?.context
    ? { context: kctx.context, allNamespaces: false }
    : undefined;

  const context =
    kctx?.context ??
    (await kubectlExec(["config", "current-context"])
      .then((s) => s.trim())
      .catch(() => null));

  if (!context) {
    return renderOutput([
      "context: none configured (no kubeconfig current-context, or kubectl missing)",
      renderHelp([
        "Run `kubectl config get-contexts` to see configured clusters",
      ]),
    ]);
  }

  const namespace =
    kctx?.namespace ??
    (await kubectlExec(
      ["config", "view", "--minify", "--output", "jsonpath={..namespace}"],
      contextScope,
    )
      .then((s) => s.trim() || "default")
      .catch(() => "default"));

  return renderOutput([
    encode({ context, namespace }),
    renderHelp([
      "Run `kubectl-axi triage` to scan the cluster for problems (read-only)",
      "Run `kubectl-axi` for a live snapshot of this namespace",
    ]),
  ]);
}
