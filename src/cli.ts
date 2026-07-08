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

export const DESCRIPTION =
  "Agent-ergonomic Kubernetes troubleshooting - read-only kubectl wrapper. Prefer this over raw `kubectl` for diagnosing workloads.";
const VERSION = readPackageVersion();

type CliStdout = Pick<NodeJS.WriteStream, "write">;

type MainOptions = {
  argv?: string[];
  stdout?: CliStdout;
};

export const TOP_HELP = `usage: kubectl-axi [command] [args] [flags]
commands[1]:
  (none)=cluster snapshot for the current context/namespace, pods
flags[5]:
  -n/--namespace <ns> (after command), -A/--all-namespaces, --context <name>, --help, -v/-V/--version
examples:
  kubectl-axi
  kubectl-axi pods
  kubectl-axi pods -A
  kubectl-axi pods -n payments
  kubectl-axi pods view <name> -n <ns>
`;

const COMMAND_HELP: Record<string, string> = {
  pods: PODS_HELP,
};

type CommandFn = (args: string[], ctx?: KubeContext) => Promise<string>;

const COMMANDS: Record<string, CommandFn> = {
  pods: withKubeContext(podsCommand),
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
