/* eslint-disable @typescript-eslint/no-explicit-any -- child-process errors are dynamic */
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatTrajectory, grade, validateCommandPolicy } from "./grader.js";
import { extractFinalText, parseClaudeJsonl } from "./usage.js";
import {
  extractGeminiFinalText,
  formatGeminiTrajectory,
  parseGeminiJsonl,
} from "./gemini.js";
import type { RunResult, RunSpec, UsageMetrics } from "./types.js";

const AGENT_TIMEOUT_MS = 5 * 60 * 1000;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Agents can mutate the shared fixture cluster (a raw-kubectl run once
 * "fixed" the endpoints fault, poisoning every later run of that task).
 * Re-assert fixture state before each run. BENCH_SKIP_RECONCILE=1 skips.
 */
function reconcileFixtures(kubeconfig: string): void {
  if (process.env.BENCH_SKIP_RECONCILE === "1") return;
  execFileSync("bash", [join(REPO_ROOT, "scripts", "reconcile-faults.sh")], {
    env: { ...process.env, KUBECONFIG: kubeconfig },
    timeout: 180_000,
    stdio: "pipe",
  });
}

interface AgentRun {
  usage: UsageMetrics;
  /** Judge-readable trajectory (agent-specific format normalized). */
  trajectory: string;
  finalText: string;
}

export function runOne(spec: RunSpec, resultsDir: string): RunResult {
  const { condition, task, run } = spec;
  const artifactDir = join(resultsDir, condition.id, task.id, `run${run}`);
  const workspaceDir = join(artifactDir, "workspace");
  mkdirSync(workspaceDir, { recursive: true });
  reconcileFixtures(spec.kubeconfig);

  let agentRun: AgentRun;
  try {
    agentRun =
      spec.agent === "gemini"
        ? runGemini(spec, artifactDir, workspaceDir)
        : runClaude(spec, artifactDir, workspaceDir);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }

  const policyViolation = validateCommandPolicy(
    agentRun.usage.command_log,
    condition.command_policy,
  );
  const gradeResult = policyViolation
    ? {
        task_success: false,
        details: policyViolation,
        failure_reason: "policy_violation" as const,
      }
    : grade(task, agentRun.trajectory);
  writeFileSync(
    join(artifactDir, "grade.json"),
    JSON.stringify(gradeResult, null, 2),
  );

  const result: RunResult = {
    condition: condition.id,
    task: task.id,
    run,
    model: spec.model,
    agent: spec.agent,
    timestamp: new Date().toISOString(),
    usage: agentRun.usage,
    grade: gradeResult,
    agent_output: agentRun.finalText,
  };
  upsertResult(resultsDir, result);
  return result;
}

function runClaude(
  spec: RunSpec,
  artifactDir: string,
  workspaceDir: string,
): AgentRun {
  const { condition, task } = spec;
  // CLAUDE.md is written for auditability; the agent actually receives the
  // condition guidance via --append-system-prompt (auto-discovery is off).
  writeFileSync(join(workspaceDir, "CLAUDE.md"), condition.agents_md);

  const emptyMcpPath = join(artifactDir, ".empty-mcp-config.json");
  writeFileSync(emptyMcpPath, JSON.stringify({ mcpServers: {} }));
  let mcpConfigPath = emptyMcpPath;
  let allowedTools = "Bash,Read,Write";
  if (condition.mcp_config) {
    mcpConfigPath = join(artifactDir, ".mcp-config.json");
    writeFileSync(mcpConfigPath, JSON.stringify(condition.mcp_config, null, 2));
    allowedTools = "Read,Write";
  }

  const args = [
    "--setting-sources", "",
    "-p", task.prompt,
    "--model", spec.model,
    "--output-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--no-session-persistence",
    "--append-system-prompt", condition.agents_md,
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--mcp-config", mcpConfigPath,
    "--allowedTools", allowedTools,
    "--disallowedTools", "WebFetch,WebSearch",
  ];

  const { output, wallClockSeconds } = execAgent("claude", args, {
    kubeconfig: spec.kubeconfig,
    cwd: workspaceDir,
    artifactDir,
  });

  writeFileSync(join(artifactDir, "agent_output.txt"), output);
  return {
    usage: parseClaudeJsonl(output, { wallClockSeconds }),
    trajectory: formatTrajectory(output),
    finalText: extractFinalText(output),
  };
}

function runGemini(
  spec: RunSpec,
  artifactDir: string,
  workspaceDir: string,
): AgentRun {
  const { condition, task } = spec;
  if (condition.mcp_config) {
    throw new Error(
      `condition ${condition.id} needs MCP, which the Gemini backend does not yet support`,
    );
  }
  // Gemini has no --append-system-prompt; it reads GEMINI.md from the
  // workspace as ambient context (the CLAUDE.md equivalent).
  writeFileSync(join(workspaceDir, "GEMINI.md"), condition.agents_md);

  const args = [
    "-y", "@google/gemini-cli",
    "-p", task.prompt,
    "--model", spec.model,
    "--output-format", "stream-json",
    "--approval-mode", "yolo",
    "--skip-trust",
  ];

  const { output, wallClockSeconds } = execAgent("npx", args, {
    kubeconfig: spec.kubeconfig,
    cwd: workspaceDir,
    artifactDir,
    extraEnv: process.env.GEMINI_API_KEY
      ? { GEMINI_API_KEY: process.env.GEMINI_API_KEY }
      : {},
  });

  writeFileSync(join(artifactDir, "agent_output.txt"), output);
  return {
    usage: parseGeminiJsonl(output, {
      model: spec.model,
      wallClockSeconds,
    }),
    trajectory: formatGeminiTrajectory(output),
    finalText: extractGeminiFinalText(output),
  };
}

function execAgent(
  bin: string,
  args: string[],
  opts: {
    kubeconfig: string;
    cwd: string;
    artifactDir: string;
    extraEnv?: Record<string, string>;
  },
): { output: string; wallClockSeconds: number } {
  let output: string;
  const started = Date.now();
  try {
    output = execFileSync(bin, args, {
      encoding: "utf-8",
      timeout: AGENT_TIMEOUT_MS,
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, KUBECONFIG: opts.kubeconfig, ...opts.extraEnv },
      cwd: opts.cwd,
    });
  } catch (error: any) {
    output = String(error?.stdout ?? "");
    writeFileSync(
      join(opts.artifactDir, "stderr.txt"),
      String(error?.stderr ?? error),
    );
  }
  return { output, wallClockSeconds: (Date.now() - started) / 1000 };
}

/** Re-runs replace prior results for the same condition/task/run. */
function upsertResult(resultsDir: string, result: RunResult): void {
  mkdirSync(resultsDir, { recursive: true });
  const file = join(resultsDir, `${result.condition}.jsonl`);
  let kept: string[] = [];
  if (existsSync(file)) {
    kept = readFileSync(file, "utf-8")
      .split("\n")
      .filter(Boolean)
      .filter((line) => {
        try {
          const parsed = JSON.parse(line) as RunResult;
          return !(parsed.task === result.task && parsed.run === result.run);
        } catch {
          return false;
        }
      });
  }
  writeFileSync(file, kept.length > 0 ? `${kept.join("\n")}\n` : "");
  appendFileSync(file, `${JSON.stringify(result)}\n`);
}

/** Fail fast if the fixture cluster or required tooling is missing. */
export function precheck(kubeconfig: string, needsKubectlAxi: boolean): void {
  execFileSync("kubectl", ["get", "namespace", "fault-oom"], {
    env: { ...process.env, KUBECONFIG: kubeconfig },
    timeout: 15_000,
    stdio: "pipe",
  });
  if (needsKubectlAxi) {
    execFileSync("kubectl-axi", ["--version"], { timeout: 60_000, stdio: "pipe" });
  }
}
