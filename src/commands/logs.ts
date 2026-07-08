import type { KubeContext } from "../context.js";
import { kubectlExec, kubectlJson } from "../kubectl.js";
import { AxiError } from "../errors.js";
import { getFlag, getPositional, hasFlag, validateFlags } from "../args.js";
import { renderHelp, renderOutput } from "../toon.js";
import { containerStateString, type Pod } from "../podstatus.js";

export const LOGS_HELP = `usage: kubectl-axi logs <pod> [flags]
description: container logs with sane defaults - last 100 lines, size-capped, restart-aware
flags{logs}:
  -c/--container <name> (required only for multi-container pods), --tail <n> (default 100), --previous
global flags: -n/--namespace <ns>, --context <name>
examples:
  kubectl-axi logs checkout-58fd7b6c5-x2k4j -n payments
  kubectl-axi logs api-abc123 --previous
  kubectl-axi logs web-abc123 -c log-shipper --tail 200`;

const DEFAULT_TAIL = 100;
const MAX_LOG_CHARS = 20_000;

export async function logsCommand(
  args: string[],
  ctx?: KubeContext,
): Promise<string> {
  if (args[0] === "--help") return LOGS_HELP;

  if (ctx?.allNamespaces) {
    throw new AxiError(
      "logs targets a single pod; -A/--all-namespaces is not valid here",
      "VALIDATION_ERROR",
      ["Pass the pod's namespace instead: `kubectl-axi logs <pod> -n <ns>`"],
    );
  }

  const podName = getPositional(args, 0);
  if (!podName) {
    throw new AxiError(
      "Pod name is required: kubectl-axi logs <pod>",
      "VALIDATION_ERROR",
      ["Run `kubectl-axi pods` to list pod names"],
    );
  }

  validateFlags(
    "logs",
    args,
    {
      valueFlags: ["-c", "--container", "--tail"],
      boolFlags: ["--previous"],
    },
    "-c/--container, --tail, --previous, -n/--namespace, --context",
  );

  const tailArg = getFlag(args, "--tail") ?? `${DEFAULT_TAIL}`;
  const tail = Number.parseInt(tailArg, 10);
  if (Number.isNaN(tail) || tail <= 0) {
    throw new AxiError(
      `Invalid --tail value: ${tailArg}`,
      "VALIDATION_ERROR",
      ["--tail takes a positive line count, e.g. --tail 200"],
    );
  }
  const previous = hasFlag(args, "--previous");

  // The pod JSON drives container selection, restart hints, and --previous
  // validation - all before any logs call, so errors are precise.
  const pod = await kubectlJson<Pod>(["get", "pod", podName, "-o", "json"], ctx);
  const container = selectContainer(pod, getFlag(args, "-c") ?? getFlag(args, "--container"));

  const status = [
    ...(pod.status?.containerStatuses ?? []),
    ...(pod.status?.initContainerStatuses ?? []),
  ].find((s) => s.name === container);
  const restarts = status?.restartCount ?? 0;

  if (previous && restarts === 0 && !status?.lastState?.terminated) {
    throw new AxiError(
      `Container ${container} has no previous run (0 restarts)`,
      "VALIDATION_ERROR",
      [`Run \`kubectl-axi logs ${podName} -c ${container}${nsFlag(ctx)}\` for the current run`],
    );
  }

  const logArgs = ["logs", podName, "-c", container, `--tail=${tail}`];
  if (previous) {
    logArgs.push("--previous");
  }
  const raw = await kubectlExec(logArgs, ctx);

  const totalChars = raw.length;
  const truncated = totalChars > MAX_LOG_CHARS;
  const shown = truncated ? raw.slice(-MAX_LOG_CHARS) : raw;
  const lineCount = shown.length === 0 ? 0 : shown.trimEnd().split("\n").length;

  const header = [
    `container: ${container} (pod ${podName}, namespace ${pod.metadata.namespace ?? "default"})`,
    `source: ${previous ? "previous run (--previous)" : "current run"}`,
    truncated
      ? `lines: last ${lineCount} shown (truncated to ${MAX_LOG_CHARS} of ${totalChars} chars; lower --tail or grep)`
      : `lines: ${lineCount} (--tail ${tail}, ${totalChars} chars)`,
  ].join("\n");

  const body =
    shown.trimEnd().length > 0
      ? `---\n${shown.trimEnd()}\n---`
      : "logs: (empty - this run has produced no output)";

  const hints: string[] = [];
  if (!previous && restarts > 0) {
    hints.push(
      `Container restarted ${restarts}x; run \`kubectl-axi logs ${podName} -c ${container} --previous${nsFlag(ctx)}\` for logs before the last restart`,
    );
  }

  return renderOutput([header, body, renderHelp(hints)]);
}

/**
 * Resolve the target container. Single-container pods need no flag; for
 * multi-container pods the error carries each container's state and, when
 * exactly one is broken, the ready-to-run command (one-turn correction).
 */
function selectContainer(pod: Pod, requested: string | undefined): string {
  const specs = [
    ...(pod.spec?.containers ?? []),
    ...(pod.spec?.initContainers ?? []),
  ];
  const names = specs.map((c) => c.name);

  if (requested) {
    if (!names.includes(requested)) {
      throw new AxiError(
        `Container "${requested}" not found in pod ${pod.metadata.name}`,
        "VALIDATION_ERROR",
        [`Containers in this pod: ${names.join(", ")}`],
      );
    }
    return requested;
  }

  if (names.length === 1) {
    return names[0];
  }

  const statuses = [
    ...(pod.status?.containerStatuses ?? []),
    ...(pod.status?.initContainerStatuses ?? []),
  ];
  const broken = statuses.filter(
    (s) => (s.restartCount ?? 0) > 0 || s.state?.waiting !== undefined,
  );
  const stateLines = names.map((name) => {
    const status = statuses.find((s) => s.name === name);
    return `${name} (${status ? containerStateString(status) : "no status"})`;
  });

  const suggestions = [`Containers in this pod: ${stateLines.join(", ")}`];
  if (broken.length === 1) {
    suggestions.unshift(
      `Run \`kubectl-axi logs ${pod.metadata.name} -c ${broken[0].name}\` - it is the one failing`,
    );
  }

  throw new AxiError(
    `Pod ${pod.metadata.name} has ${names.length} containers; pass -c <name>`,
    "VALIDATION_ERROR",
    suggestions,
  );
}

function nsFlag(ctx?: KubeContext): string {
  return ctx?.namespace ? ` -n ${ctx.namespace}` : "";
}
