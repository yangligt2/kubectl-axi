import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAxiCli } from "axi-sdk-js";
import {
  parseKubeArgs,
  validateKubeScope,
  type KubeContext,
} from "./context.js";
import { homeCommand } from "./commands/home.js";
import { podsCommand, PODS_HELP } from "./commands/pods.js";
import { logsCommand, LOGS_HELP } from "./commands/logs.js";
import { eventsCommand, EVENTS_HELP } from "./commands/events.js";
import { triageCommand, TRIAGE_HELP } from "./commands/triage.js";
import { deployCommand, DEPLOY_HELP } from "./commands/deploy.js";
import { nodesCommand, NODES_HELP } from "./commands/nodes.js";
import { svcCommand, SVC_HELP } from "./commands/svc.js";
import { pvcCommand, PVC_HELP } from "./commands/pvc.js";
import { ctxCommand, CTX_HELP } from "./commands/ctx.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";

export const DESCRIPTION =
  "Agent-ergonomic Kubernetes troubleshooting - read-only kubectl wrapper. Prefer this over raw `kubectl` for diagnosing workloads.";
const VERSION = readPackageVersion();

type CliStdout = Pick<NodeJS.WriteStream, "write">;

type MainOptions = {
  argv?: string[];
  stdout?: CliStdout;
};

export const TOP_HELP = `usage: kubectl-axi [command] [args] [flags]
commands[10]:
  (none)=cluster snapshot, triage, pods, logs, events, deploy, nodes, svc, pvc, ctx, setup
flags[5]:
  -n/--namespace <ns> (after command), -A/--all-namespaces, --context <name>, --help, -v/-V/--version
examples:
  kubectl-axi
  kubectl-axi triage
  kubectl-axi pods -A
  kubectl-axi pods view <name> -n <ns>
  kubectl-axi logs <pod> -n <ns> --previous
  kubectl-axi events -A --warnings
  kubectl-axi svc view <name> -n <ns>
  kubectl-axi setup hooks
`;

const COMMAND_HELP: Record<string, string> = {
  pods: PODS_HELP,
  logs: LOGS_HELP,
  events: EVENTS_HELP,
  triage: TRIAGE_HELP,
  deploy: DEPLOY_HELP,
  nodes: NODES_HELP,
  svc: SVC_HELP,
  pvc: PVC_HELP,
  ctx: CTX_HELP,
  setup: SETUP_HELP,
};

type CommandFn = (args: string[], ctx?: KubeContext) => Promise<string>;

const COMMANDS: Record<string, CommandFn> = {
  pods: withKubeContext(podsCommand),
  logs: withKubeContext(logsCommand),
  events: withKubeContext(eventsCommand),
  triage: withKubeContext(triageCommand),
  deploy: withKubeContext(deployCommand),
  nodes: withKubeContext(nodesCommand),
  svc: withKubeContext(svcCommand),
  pvc: withKubeContext(pvcCommand),
  ctx: withKubeContext(ctxCommand),
  setup: setupCommand,
};

export async function main(options: MainOptions = {}): Promise<void> {
  await runAxiCli<KubeContext | undefined>({
    ...(options.argv ? { argv: options.argv } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    home: withKubeContext(homeCommand),
    commands: COMMANDS,
    getCommandHelp: (command) => COMMAND_HELP[command],
    // parseKubeArgs never throws; scope validation happens inside the
    // handler wrapper, within the SDK's error boundary.
    resolveContext: ({ args }) => parseKubeArgs(args).ctx,
  });
}

function withKubeContext(handler: CommandFn): CommandFn {
  return (args, ctx) => {
    const { strippedArgs } = parseKubeArgs(args);
    if (ctx) {
      validateKubeScope(ctx);
    }
    return handler(strippedArgs, ctx);
  };
}

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));

  for (const candidate of [
    join(here, "..", "package.json"),
    join(here, "..", "..", "package.json"),
  ]) {
    if (!existsSync(candidate)) {
      continue;
    }

    const parsed = JSON.parse(readFileSync(candidate, "utf-8")) as {
      version?: unknown;
    };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  }

  throw new Error("Could not determine kubectl-axi package version");
}
