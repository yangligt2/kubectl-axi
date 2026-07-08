import { AxiError } from "./errors.js";

/**
 * Cluster/namespace scope for a command invocation. These are the CLI's
 * always-allowed globals (AXI P6): parsed and stripped before any command
 * handler sees the args, so subcommand flag validation never has to know
 * about them.
 */
export interface KubeContext {
  /** kubectl context name; undefined = kubeconfig current-context. */
  context?: string;
  /** Target namespace; undefined = the context's default namespace. */
  namespace?: string;
  /** True when -A/--all-namespaces was passed (list commands only). */
  allNamespaces: boolean;
}

export interface ParsedKubeArgs {
  ctx: KubeContext;
  strippedArgs: string[];
}

/**
 * Extract -n/--namespace, -A/--all-namespaces, and --context from args.
 * Accepts both space and equals forms for value flags. Never throws: the
 * SDK calls resolveContext outside its error boundary, so combination
 * checks live in validateKubeScope (called from the handler path).
 */
export function parseKubeArgs(args: string[]): ParsedKubeArgs {
  const stripped: string[] = [];
  let namespace: string | undefined;
  let context: string | undefined;
  let allNamespaces = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if ((arg === "-n" || arg === "--namespace") && index + 1 < args.length) {
      namespace = args[index + 1];
      index++;
      continue;
    }
    if (arg.startsWith("--namespace=") && arg.length > "--namespace=".length) {
      namespace = arg.slice("--namespace=".length);
      continue;
    }
    if (arg.startsWith("-n=") && arg.length > 3) {
      namespace = arg.slice(3);
      continue;
    }

    if (arg === "-A" || arg === "--all-namespaces") {
      allNamespaces = true;
      continue;
    }

    if (arg === "--context" && index + 1 < args.length) {
      context = args[index + 1];
      index++;
      continue;
    }
    if (arg.startsWith("--context=") && arg.length > "--context=".length) {
      context = arg.slice("--context=".length);
      continue;
    }

    stripped.push(arg);
  }

  return { ctx: { context, namespace, allNamespaces }, strippedArgs: stripped };
}

/** Reject contradictory scope flags. Runs inside the CLI error boundary. */
export function validateKubeScope(ctx: KubeContext): void {
  if (ctx.namespace !== undefined && ctx.allNamespaces) {
    throw new AxiError(
      "-n/--namespace and -A/--all-namespaces cannot be combined",
      "VALIDATION_ERROR",
      ["Pass either a single namespace or -A, not both"],
    );
  }
}

/** Human-readable scope phrase for count lines and empty states. */
export function describeScope(ctx?: KubeContext): string {
  if (ctx?.allNamespaces) {
    return "all namespaces";
  }
  if (ctx?.namespace) {
    return `namespace ${ctx.namespace}`;
  }
  return "the current namespace";
}
