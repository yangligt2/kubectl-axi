/* eslint-disable @typescript-eslint/no-explicit-any -- stream-json lines are dynamic */
import type { UsageMetrics } from "./types.js";

// Gemini CLI does not report cost, so we derive it from token counts.
// Per-1M-token USD rates from ai.google.dev/gemini-api/docs/pricing
// (standard tier, prompts <= 200k tokens), verified 2026-07-10.
const GEMINI_PRICING: Record<
  string,
  { input: number; cached: number; output: number }
> = {
  "gemini-3.5-flash": { input: 1.5, cached: 0.15, output: 9.0 },
  "gemini-3.1-pro-preview": { input: 2.0, cached: 0.2, output: 12.0 },
};

const SHELL_TOOL = "run_shell_command";

/**
 * Parse Gemini CLI `--output-format stream-json` into the shared UsageMetrics.
 * Shape differs from Claude: assistant text arrives as deltas, the shell tool
 * is `run_shell_command` with `parameters.command`, and the final `result`
 * event carries a `stats` block (tokens but no cost).
 */
export function parseGeminiJsonl(
  raw: string,
  opts: { model?: string; wallClockSeconds?: number } = {},
): UsageMetrics {
  let inputTokens = 0;
  let cachedTokens = 0;
  let outputTokens = 0;
  let wallClock = opts.wallClockSeconds ?? 0;
  let toolUseCount = 0;
  let commandCount = 0;
  let errorCount = 0;
  const commandLog: string[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (event.type === "tool_use") {
      toolUseCount++;
      if (event.tool_name === SHELL_TOOL && event.parameters?.command) {
        commandCount++;
        commandLog.push(String(event.parameters.command));
      }
    } else if (event.type === "tool_result" && event.status === "error") {
      errorCount++;
    } else if (event.type === "result") {
      const stats = event.stats ?? {};
      inputTokens = stats.input_tokens ?? 0;
      cachedTokens = stats.cached ?? 0;
      outputTokens = stats.output_tokens ?? 0;
      if (stats.duration_ms) wallClock = stats.duration_ms / 1000;
    }
  }

  const pricing = opts.model ? GEMINI_PRICING[opts.model] : undefined;
  const uncached = Math.max(inputTokens - cachedTokens, 0);
  const cost = pricing
    ? (uncached * pricing.input +
        cachedTokens * pricing.cached +
        outputTokens * pricing.output) /
      1_000_000
    : 0;

  return {
    input_tokens: inputTokens,
    input_tokens_cached: cachedTokens,
    output_tokens: outputTokens,
    total_cost_usd: cost,
    wall_clock_seconds: wallClock,
    // Gemini reports no num_turns; approximate round-trips as tool calls + the
    // final answer. Consistent within Gemini runs, which is what condition
    // comparison needs.
    turn_count: toolUseCount + 1,
    command_count: commandCount,
    error_count: errorCount,
    command_log: commandLog,
  };
}

/** Extract Gemini's final text answer (assistant deltas, tail-truncated). */
export function extractGeminiFinalText(raw: string): string {
  let text = "";
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = JSON.parse(trimmed);
      if (
        event.type === "message" &&
        event.role === "assistant" &&
        typeof event.content === "string"
      ) {
        text += event.content;
      }
    } catch {
      continue;
    }
  }
  return text.trim().slice(-2000);
}

/** Format Gemini's trajectory into the same judge-readable text as Claude's. */
export function formatGeminiTrajectory(raw: string): string {
  const lines: string[] = [];
  let assistantBuffer = "";

  const flush = () => {
    const text = assistantBuffer.trim();
    if (text) lines.push(`AGENT: ${text}`);
    assistantBuffer = "";
  };

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (event.type === "message" && event.role === "assistant") {
      assistantBuffer += String(event.content ?? "");
      continue;
    }
    flush();

    if (event.type === "tool_use") {
      if (event.tool_name === SHELL_TOOL) {
        lines.push(`COMMAND: ${event.parameters?.command ?? ""}`);
      } else {
        lines.push(
          `TOOL_CALL: ${event.tool_name}(${JSON.stringify(event.parameters ?? {}).slice(0, 500)})`,
        );
      }
    } else if (event.type === "tool_result") {
      const text = String(event.output ?? "");
      lines.push(
        text.length > 30_000
          ? `OUTPUT: ${text.slice(0, 30_000)} [TRUNCATED from ${text.length} chars]`
          : `OUTPUT: ${text}`,
      );
    }
  }
  flush();

  return lines
    .join("\n")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/\0/g, "");
}
