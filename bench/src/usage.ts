/* eslint-disable @typescript-eslint/no-explicit-any -- stream-json lines are dynamic */
import type { UsageMetrics } from "./types.js";

/**
 * Parse Claude CLI `--output-format stream-json` output into usage metrics.
 * The final `result` event is authoritative; assistant-message usage is the
 * fallback when the agent crashed before emitting it.
 */
export function parseClaudeJsonl(
  raw: string,
  opts: { wallClockSeconds?: number } = {},
): UsageMetrics {
  let inputTokens = 0;
  let cachedTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  let turns = 0;
  let wallClock = opts.wallClockSeconds ?? 0;
  let commandCount = 0;
  let errorCount = 0;
  const commandLog: string[] = [];
  let sawResult = false;
  let fallbackInput = 0;
  let fallbackCached = 0;
  let fallbackOutput = 0;

  const recordToolUse = (block: any) => {
    if ((block?.name ?? block?.tool) === "Bash" && block?.input?.command) {
      commandCount++;
      commandLog.push(String(block.input.command));
    }
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

    if (event.type === "assistant") {
      for (const block of event.message?.content ?? []) {
        if (block?.type === "tool_use") recordToolUse(block);
      }
      const usage = event.message?.usage;
      if (usage) {
        fallbackInput +=
          (usage.input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0);
        fallbackCached += usage.cache_read_input_tokens ?? 0;
        fallbackOutput += usage.output_tokens ?? 0;
      }
    } else if (event.type === "user") {
      for (const block of event.message?.content ?? []) {
        if (block?.type === "tool_result" && block?.is_error === true) {
          errorCount++;
        }
      }
    } else if (event.type === "result") {
      sawResult = true;
      cost = event.total_cost_usd ?? 0;
      turns = event.num_turns ?? 0;
      if (event.duration_ms) wallClock = event.duration_ms / 1000;
      const usage = event.usage;
      if (usage) {
        inputTokens =
          (usage.input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0);
        cachedTokens = usage.cache_read_input_tokens ?? 0;
        outputTokens = usage.output_tokens ?? 0;
      }
    }
  }

  if (!sawResult || inputTokens === 0) {
    inputTokens = inputTokens || fallbackInput;
    cachedTokens = cachedTokens || fallbackCached;
    outputTokens = outputTokens || fallbackOutput;
  }

  return {
    input_tokens: inputTokens,
    input_tokens_cached: cachedTokens,
    output_tokens: outputTokens,
    total_cost_usd: cost,
    wall_clock_seconds: wallClock,
    turn_count: turns,
    command_count: commandCount,
    error_count: errorCount,
    command_log: commandLog,
  };
}

/** Extract the agent's final text answer from stream-json output. */
export function extractFinalText(raw: string): string {
  let finalText = "";
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event.type === "result" && typeof event.result === "string") {
        finalText = event.result;
      }
    } catch {
      continue;
    }
  }
  return finalText.slice(0, 2000);
}
