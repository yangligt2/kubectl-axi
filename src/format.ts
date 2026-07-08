/**
 * Shared formatting helpers for consistent count, scope, and truncation
 * phrasing across commands.
 */

export interface CountLineOptions {
  count: number;
  /** Number of not-ready items, surfaced inline when > 0. */
  notReady?: number;
  /** Scope phrase, e.g. "namespace payments" or "all namespaces". */
  scope?: string;
}

export function formatCountLine(opts: CountLineOptions): string {
  const { count, notReady, scope } = opts;
  const scopeSuffix = scope ? ` in ${scope}` : "";
  if (notReady !== undefined && notReady > 0) {
    return `count: ${count}${scopeSuffix} (${notReady} not ready)`;
  }
  return `count: ${count}${scopeSuffix}`;
}

/** Definitive empty-state line (AXI P5): the zero IS the answer. */
export function formatEmptyLine(noun: string, scope: string): string {
  return `${noun}: none found in ${scope}`;
}

/** Truncate long free text for table cells (event messages etc.). */
export function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 3)}...`;
}
