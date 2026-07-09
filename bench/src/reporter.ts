import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunResult } from "./types.js";

interface ConditionSummary {
  condition: string;
  runs: number;
  success_rate: number;
  avg_input_tokens: number;
  avg_output_tokens: number;
  avg_cost_usd: number;
  avg_duration_seconds: number;
  avg_turns: number;
}

export function loadResults(resultsDir: string): RunResult[] {
  const results: RunResult[] = [];
  let files: string[];
  try {
    files = readdirSync(resultsDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return results;
  }
  for (const file of files) {
    for (const line of readFileSync(join(resultsDir, file), "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        results.push(JSON.parse(line) as RunResult);
      } catch {
        continue;
      }
    }
  }
  return results;
}

function summarize(results: RunResult[]): ConditionSummary[] {
  const byCondition = new Map<string, RunResult[]>();
  for (const result of results) {
    const list = byCondition.get(result.condition) ?? [];
    list.push(result);
    byCondition.set(result.condition, list);
  }

  const avg = (values: number[]) =>
    values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

  return [...byCondition.entries()]
    .map(([condition, runs]) => ({
      condition,
      runs: runs.length,
      success_rate: avg(runs.map((r) => (r.grade.task_success ? 1 : 0))),
      avg_input_tokens: avg(runs.map((r) => r.usage.input_tokens)),
      avg_output_tokens: avg(runs.map((r) => r.usage.output_tokens)),
      avg_cost_usd: avg(runs.map((r) => r.usage.total_cost_usd)),
      avg_duration_seconds: avg(runs.map((r) => r.usage.wall_clock_seconds)),
      avg_turns: avg(runs.map((r) => r.usage.turn_count)),
    }))
    .sort((a, b) => a.avg_cost_usd - b.avg_cost_usd);
}

export function writeReports(resultsDir: string): string {
  const results = loadResults(resultsDir);
  const summaries = summarize(results);

  const md: string[] = [
    "# bench-k8s report",
    "",
    `Runs: ${results.length}`,
    "",
    "| Condition | Runs | Success | Avg Input Tokens | Avg Output Tokens | Avg Cost | Avg Duration | Avg Turns |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const s of summaries) {
    md.push(
      `| ${s.condition} | ${s.runs} | ${(s.success_rate * 100).toFixed(0)}% | ${Math.round(s.avg_input_tokens).toLocaleString()} | ${Math.round(s.avg_output_tokens).toLocaleString()} | $${s.avg_cost_usd.toFixed(3)} | ${s.avg_duration_seconds.toFixed(1)}s | ${s.avg_turns.toFixed(1)} |`,
    );
  }

  // Per-task failure listing keeps diagnosis cheap after a matrix run.
  const failures = results.filter((r) => !r.grade.task_success);
  if (failures.length > 0) {
    md.push("", "## Failures", "");
    md.push("| Condition | Task | Run | Reason | Details |");
    md.push("| --- | --- | --- | --- | --- |");
    for (const f of failures) {
      md.push(
        `| ${f.condition} | ${f.task} | ${f.run} | ${f.grade.failure_reason ?? ""} | ${f.grade.details.replace(/\|/g, "\\|").slice(0, 160)} |`,
      );
    }
  }

  const csvLines = [
    "condition,task,run,model,timestamp,success,input_tokens,input_tokens_cached,output_tokens,total_cost_usd,wall_clock_seconds,turn_count,command_count,error_count",
    ...results.map((r) =>
      [
        r.condition,
        r.task,
        r.run,
        r.model,
        r.timestamp,
        r.grade.task_success,
        r.usage.input_tokens,
        r.usage.input_tokens_cached,
        r.usage.output_tokens,
        r.usage.total_cost_usd,
        r.usage.wall_clock_seconds,
        r.usage.turn_count,
        r.usage.command_count,
        r.usage.error_count,
      ].join(","),
    ),
  ];

  const markdown = md.join("\n") + "\n";
  writeFileSync(join(resultsDir, "report.md"), markdown);
  writeFileSync(join(resultsDir, "report.csv"), csvLines.join("\n") + "\n");
  return markdown;
}
