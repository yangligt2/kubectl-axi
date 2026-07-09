/* eslint-disable @typescript-eslint/no-explicit-any -- stream-json lines are dynamic */
import { execFileSync, execSync } from "node:child_process";
import type { CommandPolicy, GradeResult, TaskDef } from "./types.js";

const JUDGE_MODEL = "claude-sonnet-4-6";
const MAX_JUDGE_RETRIES = 3;
const RETRY_BACKOFF_SECONDS = [10, 30, 60];
const TOOL_OUTPUT_LIMIT = 30_000;

/** Convert the agent's stream-json trajectory into judge-readable text. */
export function formatTrajectory(raw: string): string {
  const lines: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (event.type === "assistant") {
      for (const block of event.message?.content ?? []) {
        if (block?.type === "text" && block.text) {
          lines.push(`AGENT: ${block.text}`);
        } else if (block?.type === "tool_use") {
          if ((block.name ?? block.tool) === "Bash") {
            lines.push(`COMMAND: ${block.input?.command ?? ""}`);
          } else {
            lines.push(
              `TOOL_CALL: ${block.name}(${JSON.stringify(block.input ?? {}).slice(0, 500)})`,
            );
          }
        }
      }
    } else if (event.type === "user") {
      for (const block of event.message?.content ?? []) {
        if (block?.type === "tool_result") {
          const content =
            typeof block.content === "string"
              ? block.content
              : (block.content ?? [])
                  .map((c: any) => (c?.type === "text" ? c.text : ""))
                  .join("\n");
          const text = String(content ?? "");
          lines.push(
            text.length > TOOL_OUTPUT_LIMIT
              ? `OUTPUT: ${text.slice(0, TOOL_OUTPUT_LIMIT)} [TRUNCATED from ${text.length} chars]`
              : `OUTPUT: ${text}`,
          );
        }
      }
    } else if (event.type === "result" && typeof event.result === "string") {
      lines.push(`AGENT: ${event.result}`);
    }
  }
  return lines
    .join("\n")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/\0/g, "");
}

/** Fail runs that used forbidden tooling before wasting a judge call. */
export function validateCommandPolicy(
  commandLog: string[],
  policy: CommandPolicy | undefined,
): string | null {
  if (!policy) return null;
  for (const raw of commandLog) {
    const command = raw.trim();
    for (const forbidden of policy.forbid_any_prefix ?? []) {
      if (command.startsWith(forbidden)) {
        return `command used forbidden tooling: ${command.slice(0, 120)}`;
      }
    }
  }
  if (policy.require_any_prefix && policy.require_any_prefix.length > 0) {
    const used = commandLog.some((raw) =>
      policy.require_any_prefix!.some((prefix) =>
        raw.trim().startsWith(prefix),
      ),
    );
    if (commandLog.length > 0 && !used) {
      return `no command used the required tooling (${policy.require_any_prefix.join(", ")})`;
    }
  }
  return null;
}

function buildJudgePrompt(task: TaskDef, trajectory: string): string {
  const hint = task.grading?.grading_hint
    ? `\nKNOWN FACTS: ${task.grading.grading_hint}\n`
    : "";
  return `You are a benchmark grader evaluating whether an AI agent completed a Kubernetes troubleshooting task.

TASK: ${task.prompt}
${hint}
AGENT TRAJECTORY:
${trajectory}

Rules:
- PASS if the agent ran commands against the cluster AND produced a correct, complete answer
- FAIL if the agent reported a diagnosis without running any command that could support it (hallucination)
- FAIL if the agent ran commands but misread the evidence or blamed the wrong component
- FAIL if the agent gave a partial answer when the task requires the specific root cause (e.g. "pod is crashing" without the planted reason)
- For definitive-answer tasks (is anything wrong / node health), PASS only if the agent answers confidently after inspecting; hedging or inventing problems is a FAIL

Respond with exactly: {"pass": true, "reason": "..."} or {"pass": false, "reason": "..."}`;
}

function extractVerdict(output: string): { pass: boolean; reason: string } | null {
  const cleaned = output.replace(/```json|```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.pass === "boolean") {
      return { pass: parsed.pass, reason: String(parsed.reason ?? "") };
    }
  } catch {
    // fall through to regex
  }
  const match = cleaned.match(/\{\s*"pass"\s*:\s*(true|false)\s*,\s*"reason"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/);
  if (match) {
    return { pass: match[1] === "true", reason: match[2] };
  }
  return null;
}

export function grade(task: TaskDef, agentJsonl: string): GradeResult {
  const trajectory = formatTrajectory(agentJsonl);
  const prompt = buildJudgePrompt(task, trajectory);

  for (let attempt = 0; attempt <= MAX_JUDGE_RETRIES; attempt++) {
    let output: string;
    try {
      output = execFileSync(
        "claude",
        [
          "--setting-sources", "",
          "-p", prompt,
          "--model", JUDGE_MODEL,
          "--output-format", "text",
          "--max-turns", "1",
          "--dangerously-skip-permissions",
          "--no-session-persistence",
        ],
        { encoding: "utf-8", timeout: 120_000, maxBuffer: 50 * 1024 * 1024 },
      );
    } catch (error: any) {
      output = String(error?.stdout ?? "");
    }

    if (output.trim().length > 0) {
      const verdict = extractVerdict(output);
      if (verdict) {
        return {
          task_success: verdict.pass,
          details: verdict.reason,
          ...(verdict.pass ? {} : { failure_reason: "task_failure" as const }),
          judge_model: JUDGE_MODEL,
        };
      }
      return {
        task_success: false,
        details: `judge output unparseable: ${output.slice(0, 300)}`,
        failure_reason: "judge_parse_error",
        judge_model: JUDGE_MODEL,
      };
    }

    if (attempt < MAX_JUDGE_RETRIES) {
      execSync(`sleep ${RETRY_BACKOFF_SECONDS[attempt]}`);
    }
  }

  return {
    task_success: false,
    details: "judge produced no output after retries",
    failure_reason: "judge_error",
    judge_model: JUDGE_MODEL,
  };
}
