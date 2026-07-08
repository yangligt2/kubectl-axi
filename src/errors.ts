import { AxiError, exitCodeForError } from "axi-sdk-js";

export type ErrorCode =
  | "NOT_FOUND"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "CLUSTER_UNREACHABLE"
  | "CONTEXT_NOT_FOUND"
  | "VALIDATION_ERROR"
  | "KUBECTL_NOT_INSTALLED"
  | "UNKNOWN";

export { AxiError, exitCodeForError };

interface ErrorPattern {
  pattern: RegExp;
  code: ErrorCode;
  message: (match: RegExpMatchArray, stderr: string) => string;
  suggestions?: (match: RegExpMatchArray) => string[];
}

const patterns: ErrorPattern[] = [
  {
    pattern: /context "([^"]+)" does not exist/,
    code: "CONTEXT_NOT_FOUND",
    message: (m) => `kubectl context "${m[1]}" does not exist`,
    suggestions: () => [
      "Run `kubectl config get-contexts` to list available contexts",
    ],
  },
  {
    pattern: /context was not found for specified context: (\S+)/,
    code: "CONTEXT_NOT_FOUND",
    message: (m) => `kubectl context "${m[1]}" does not exist`,
    suggestions: () => [
      "Run `kubectl config get-contexts` to list available contexts",
    ],
  },
  {
    pattern: /Unable to connect to the server: (.+)/,
    code: "CLUSTER_UNREACHABLE",
    message: (m) => `Cannot reach the cluster: ${m[1]}`,
    suggestions: () => [
      "Check `kubectl config current-context` points at the right cluster",
      "Verify network connectivity (VPN, SSH tunnel, or proxy) to the API server",
    ],
  },
  {
    pattern: /(connection refused|no such host|i\/o timeout|TLS handshake timeout)/i,
    code: "CLUSTER_UNREACHABLE",
    message: (_m, stderr) => `Cannot reach the cluster: ${firstErrorLine(stderr)}`,
    suggestions: () => [
      "Check `kubectl config current-context` points at the right cluster",
      "Verify network connectivity (VPN, SSH tunnel, or proxy) to the API server",
    ],
  },
  {
    pattern: /namespaces "([^"]+)" not found/,
    code: "NOT_FOUND",
    message: (m) => `Namespace "${m[1]}" not found`,
    suggestions: () => [
      "Run `kubectl-axi pods -A` to see pods across existing namespaces",
    ],
  },
  {
    pattern: /Error from server \(NotFound\): (\w+)[^"]*"([^"]+)" not found/,
    code: "NOT_FOUND",
    message: (m) => `${m[1].replace(/s$/, "")} "${m[2]}" not found`,
  },
  {
    pattern: /Error from server \(Forbidden\)/,
    code: "FORBIDDEN",
    message: () => "Insufficient RBAC permissions for this action",
    suggestions: () => [
      "Run `kubectl auth can-i --list` to inspect your permissions",
    ],
  },
  {
    pattern: /Unauthorized|You must be logged in to the server/,
    code: "AUTH_REQUIRED",
    message: () =>
      "Cluster authentication failed - credentials expired or invalid",
    suggestions: () => [
      "Refresh credentials for the current context (cloud CLI login or kubeconfig update)",
    ],
  },
];

function firstErrorLine(stderr: string): string {
  const line = stderr.trim().split("\n")[0] ?? "";
  return line
    .replace(/^error:\s*/i, "")
    .replace(/^Error from server(?: \([^)]+\))?:\s*/, "");
}

export function mapKubectlError(stderr: string, exitCode: number): AxiError {
  for (const { pattern, code, message, suggestions } of patterns) {
    const match = stderr.match(pattern);
    if (match) {
      return new AxiError(
        message(match, stderr),
        code,
        suggestions?.(match) ?? [],
      );
    }
  }

  if (/not found/i.test(stderr)) {
    return new AxiError(firstErrorLine(stderr), "NOT_FOUND");
  }

  return new AxiError(
    firstErrorLine(stderr) || `kubectl exited with code ${exitCode}`,
    "UNKNOWN",
  );
}

export function kubectlNotInstalledError(): AxiError {
  return new AxiError(
    "kubectl is not installed - see https://kubernetes.io/docs/tasks/tools/",
    "KUBECTL_NOT_INSTALLED",
  );
}
