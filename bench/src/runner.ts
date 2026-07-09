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
import { join } from "node:path";
import { grade, validateCommandPolicy } from "./grader.js";
import { extractFinalText, parseClaudeJsonl } from "./usage.js";
import type { RunResult, RunSpec } from "./types.js";

const AGENT_TIMEOUT_MS = 5 * 60 * 1000;

export function runOne(spec: RunSpec, resultsDir: string): RunResult {
  const { condition, task, run } = spec;
  const artifactDir = join(resultsDir, condition.id, task.id, `run${run}`);
  const workspaceDir = join(artifactDir, "workspace");
  mkdirSync(workspaceDir, { recursive: true });

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

  let agentOutput: string;
  const started = Date.now();
  try {
    agentOutput = execFileSync("claude", args, {
      encoding: "utf-8",
      timeout: AGENT_TIMEOUT_MS,
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, KUBECONFIG: spec.kubeconfig },
      cwd: workspaceDir,
    });
  } catch (error: any) {
    agentOutput = String(error?.stdout ?? "");
    writeFileSync(join(artifactDir, "stderr.txt"), String(error?.stderr ?? error));
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
  const wallClockSeconds = (Date.now() - started) / 1000;

  writeFileSync(join(artifactDir, "agent_output.txt"), agentOutput);
  const usage = parseClaudeJsonl(agentOutput, { wallClockSeconds });

  const policyViolation = validateCommandPolicy(
    usage.command_log,
    condition.command_policy,
  );
  const gradeResult = policyViolation
    ? {
        task_success: false,
        details: policyViolation,
        failure_reason: "policy_violation" as const,
      }
    : grade(task, agentOutput);
  writeFileSync(
    join(artifactDir, "grade.json"),
    JSON.stringify(gradeResult, null, 2),
  );

  const result: RunResult = {
    condition: condition.id,
    task: task.id,
    run,
    model: spec.model,
    timestamp: new Date().toISOString(),
    usage,
    grade: gradeResult,
    agent_output: extractFinalText(agentOutput),
  };
  upsertResult(resultsDir, result);
  return result;
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
