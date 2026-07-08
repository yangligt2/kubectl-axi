import { encode } from "@toon-format/toon";
import type { KubeContext } from "../context.js";
import { describeScope } from "../context.js";
import { kubectlJson } from "../kubectl.js";
import { AxiError } from "../errors.js";
import { getFlag, hasFlag, validateFlags } from "../args.js";
import { formatEmptyLine, truncate } from "../format.js";
import { formatRelativeTime, renderHelp, renderOutput } from "../toon.js";

export const EVENTS_HELP = `usage: kubectl-axi events [flags]
description: cluster events, newest first (fixes kubectl's unsorted default)
flags{events}:
  --warnings (only type=Warning), --limit <n> (default 30)
global flags: -n/--namespace <ns>, -A/--all-namespaces, --context <name>
examples:
  kubectl-axi events
  kubectl-axi events -A --warnings
  kubectl-axi events -n payments --limit 50`;

const DEFAULT_LIMIT = 30;

export interface EventItem {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  lastTimestamp?: string;
  eventTime?: string;
  metadata?: { creationTimestamp?: string; namespace?: string };
  involvedObject?: { kind?: string; name?: string; namespace?: string };
}

interface EventList {
  items: EventItem[];
}

export function eventTimestamp(e: EventItem): string | undefined {
  return e.lastTimestamp ?? e.eventTime ?? e.metadata?.creationTimestamp;
}

export async function eventsCommand(
  args: string[],
  ctx?: KubeContext,
): Promise<string> {
  if (args[0] === "--help") return EVENTS_HELP;

  validateFlags(
    "events",
    args,
    { valueFlags: ["--limit"], boolFlags: ["--warnings"] },
    "--warnings, --limit, -n/--namespace, -A/--all-namespaces, --context",
  );

  const warningsOnly = hasFlag(args, "--warnings");
  const limitArg = getFlag(args, "--limit") ?? `${DEFAULT_LIMIT}`;
  const limit = Number.parseInt(limitArg, 10);
  if (Number.isNaN(limit) || limit <= 0) {
    throw new AxiError(`Invalid --limit value: ${limitArg}`, "VALIDATION_ERROR", [
      "--limit takes a positive count, e.g. --limit 50",
    ]);
  }

  const list = await kubectlJson<EventList>(
    ["get", "events", "-o", "json"],
    ctx,
  );
  const all = list.items ?? [];
  const filtered = warningsOnly
    ? all.filter((e) => e.type === "Warning")
    : all;

  if (filtered.length === 0) {
    const what = warningsOnly ? "warning events" : "events";
    return renderOutput([
      formatEmptyLine(what, describeScope(ctx)),
      renderHelp(
        warningsOnly
          ? ["Run `kubectl-axi events` to include Normal events"]
          : [],
      ),
    ]);
  }

  const sorted = [...filtered].sort(
    (a, b) =>
      new Date(eventTimestamp(b) ?? 0).getTime() -
      new Date(eventTimestamp(a) ?? 0).getTime(),
  );
  const shown = sorted.slice(0, limit);
  const warningCount = filtered.filter((e) => e.type === "Warning").length;

  const rows = shown.map((e) => ({
    time: formatRelativeTime(eventTimestamp(e)),
    ...(ctx?.allNamespaces
      ? { namespace: e.involvedObject?.namespace ?? e.metadata?.namespace ?? "" }
      : {}),
    type: e.type ?? "Normal",
    reason: e.reason ?? "",
    object: `${(e.involvedObject?.kind ?? "?").toLowerCase()}/${e.involvedObject?.name ?? "?"}`,
    count: e.count ?? 1,
    message: truncate((e.message ?? "").replace(/\s+/g, " ").trim(), 140),
  }));

  const countLine =
    shown.length < filtered.length
      ? `count: ${filtered.length} in ${describeScope(ctx)} (${warningCount} warnings, showing newest ${shown.length})`
      : `count: ${filtered.length} in ${describeScope(ctx)} (${warningCount} warnings)`;

  const suggestions =
    warningCount > 0
      ? [
          `Run \`kubectl-axi pods view <name> -n <ns>${ctx?.context ? ` --context ${ctx.context}` : ""}\` to inspect a pod named in a warning`,
        ]
      : [];

  return renderOutput([countLine, encode({ events: rows }), renderHelp(suggestions)]);
}
