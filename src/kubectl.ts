import { execFile } from "node:child_process";
import type { KubeContext } from "./context.js";
import { kubectlNotInstalledError, mapKubectlError } from "./errors.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Pod lists with managedFields can be large; give parsing plenty of room.
const MAX_BUFFER_BYTES = 50 * 1024 * 1024; // 50 MB

function buildArgs(args: string[], ctx?: KubeContext): string[] {
  const out = [...args];
  if (ctx?.context) {
    out.push("--context", ctx.context);
  }
  if (ctx?.allNamespaces) {
    out.push("--all-namespaces");
  } else if (ctx?.namespace) {
    out.push("--namespace", ctx.namespace);
  }
  return out;
}

function toExecResult(
  resolve: (result: ExecResult) => void,
): (error: Error | null, stdout: string, stderr: string) => void {
  return (error, stdout, stderr) => {
    if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      resolve({ stdout: "", stderr: "ENOENT", exitCode: 127 });
      return;
    }
    const exitCode = error
      ? ((error as Error & { code?: string | number }).code ?? 1)
      : 0;
    resolve({
      stdout: stdout ?? "",
      stderr: stderr ?? "",
      exitCode: typeof exitCode === "number" ? exitCode : 1,
    });
  };
}

function run(args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      "kubectl",
      args,
      { maxBuffer: MAX_BUFFER_BYTES },
      toExecResult(resolve),
    );
  });
}

/** Execute kubectl and return parsed JSON (callers pass `-o json`). */
export async function kubectlJson<T = unknown>(
  args: string[],
  ctx?: KubeContext,
): Promise<T> {
  const result = await run(buildArgs(args, ctx));
  if (result.stderr === "ENOENT") throw kubectlNotInstalledError();
  if (result.exitCode !== 0)
    throw mapKubectlError(result.stderr, result.exitCode);
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw mapKubectlError(
      result.stderr || `Unexpected kubectl output: ${result.stdout.slice(0, 200)}`,
      result.exitCode,
    );
  }
}

/** Execute kubectl and return raw stdout (trimmed by callers as needed). */
export async function kubectlExec(
  args: string[],
  ctx?: KubeContext,
): Promise<string> {
  const result = await run(buildArgs(args, ctx));
  if (result.stderr === "ENOENT") throw kubectlNotInstalledError();
  if (result.exitCode !== 0)
    throw mapKubectlError(result.stderr, result.exitCode);
  return result.stdout;
}

/** Execute kubectl, returning stdout + stderr without throwing on non-zero exit. */
export async function kubectlRaw(
  args: string[],
  ctx?: KubeContext,
): Promise<ExecResult> {
  const result = await run(buildArgs(args, ctx));
  if (result.stderr === "ENOENT") throw kubectlNotInstalledError();
  return result;
}
