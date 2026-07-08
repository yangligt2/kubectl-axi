import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AxiError, installSessionStartHooks } from "axi-sdk-js";
import { renderHelp, renderOutput } from "../toon.js";

export const SETUP_HELP = `usage: kubectl-axi setup hooks
Install or repair agent SessionStart hooks (Claude Code, Codex, OpenCode).
The hook runs \`kubectl-axi-ctx\`, which reads only the local kubeconfig -
ambient context never calls the cluster. Intended for global installs.

examples:
  kubectl-axi setup hooks
`;

export async function setupCommand(args: string[]): Promise<string> {
  if (args.length !== 1 || args[0] !== "hooks") {
    throw new AxiError("Unknown setup action", "VALIDATION_ERROR", [
      "Run `kubectl-axi setup hooks`",
    ]);
  }

  const errors: string[] = [];
  installSessionStartHooks({
    marker: "kubectl-axi",
    execPath: resolveCtxEntrypoint(),
    binaryNames: ["kubectl-axi-ctx"],
    distEntrypoints: ["dist/bin/kubectl-axi-ctx.js"],
    onError: (message) => errors.push(message),
  });

  if (errors.length > 0) {
    throw new AxiError(
      `Hook installation reported problems: ${errors.join("; ")}`,
      "UNKNOWN",
      ["Re-run `kubectl-axi setup hooks` after fixing the paths above"],
    );
  }

  return renderOutput([
    "hooks:\n  status: installed\n  integrations: Claude Code, Codex, OpenCode\n  command: kubectl-axi-ctx (kubeconfig-local only, no cluster calls)",
    renderHelp([
      "Restart your agent session to receive kubectl-axi ambient context",
    ]),
  ]);
}

/**
 * The hook must point at the ctx entrypoint, not this process's main bin.
 * Compiled layout puts this file at dist/src/commands/setup.js and the
 * entrypoint at dist/bin/kubectl-axi-ctx.js.
 */
function resolveCtxEntrypoint(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const compiled = join(here, "..", "..", "bin", "kubectl-axi-ctx.js");
  if (existsSync(compiled)) {
    return compiled;
  }
  // Dev fallback (tsx run from src/): the portable-name resolution in the
  // SDK still rewrites this to the bare binary name for global installs.
  return join(here, "..", "..", "bin", "kubectl-axi-ctx.ts");
}
