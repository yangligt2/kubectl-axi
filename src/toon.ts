import { encode } from "@toon-format/toon";

/**
 * Field extractor definitions for flattening kubectl JSON into
 * TOON-friendly rows. Conversion to TOON happens only at this boundary;
 * internal logic stays on JSON (AXI P1).
 */
export type FieldDef =
  | { type: "field"; key: string; as?: string }
  | { type: "pluck"; key: string; subkey: string; as?: string }
  | { type: "relativeTime"; key: string; as?: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- custom extractors are polymorphic by design
  | { type: "custom"; as: string; fn: (item: any) => any };

export function field(key: string, as?: string): FieldDef {
  return { type: "field", key, as };
}
export function pluck(key: string, subkey: string, as?: string): FieldDef {
  return { type: "pluck", key, subkey, as };
}
export function relativeTime(key: string, as?: string): FieldDef {
  return { type: "relativeTime", key, as };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- custom extractors are polymorphic by design
export function custom(as: string, fn: (item: any) => any): FieldDef {
  return { type: "custom", as, fn };
}

export function extract(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- items are JSON-parsed objects with dynamic keys
  item: Record<string, any>,
  schema: FieldDef[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const def of schema) {
    const outputKey = def.as ?? ("key" in def ? def.key : def.as);
    switch (def.type) {
      case "field":
        result[outputKey] = item[def.key] ?? null;
        break;
      case "pluck":
        result[outputKey] =
          (item[def.key] as Record<string, unknown> | undefined)?.[
            def.subkey
          ] ?? null;
        break;
      case "relativeTime":
        result[outputKey] = formatRelativeTime(
          item[def.key] as string | null | undefined,
        );
        break;
      case "custom":
        result[outputKey] = def.fn(item);
        break;
      default: {
        const _exhaustive: never = def;
        throw new Error(`Unknown field type: ${(_exhaustive as FieldDef).type}`);
      }
    }
  }
  return result;
}

/** Render a labeled list of items as TOON. */
export function renderList(
  label: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- items are JSON-parsed objects with dynamic keys
  items: Record<string, any>[],
  schema: FieldDef[],
): string {
  const extracted = items.map((item) => extract(item, schema));
  return encode({ [label]: extracted });
}

/** Render a single labeled detail object as TOON. */
export function renderDetail(
  label: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- items are JSON-parsed objects with dynamic keys
  item: Record<string, any>,
  schema: FieldDef[],
): string {
  const extracted = extract(item, schema);
  return encode({ [label]: extracted });
}

/** Render help suggestions (manual formatting - encode() inlines primitive arrays). */
export function renderHelp(lines: string[]): string {
  if (lines.length === 0) return "";
  const indented = lines.map((l) => `  ${l}`).join("\n");
  return `help[${lines.length}]:\n${indented}`;
}

/** Render an error in TOON format. */
export function renderError(
  message: string,
  code: string,
  suggestions: string[] = [],
): string {
  const blocks = [encode({ error: message, code })];
  if (suggestions.length > 0) {
    blocks.push(renderHelp(suggestions));
  }
  return blocks.join("\n");
}

/** Combine multiple TOON blocks into a single output string. */
export function renderOutput(blocks: string[]): string {
  return blocks.filter(Boolean).join("\n");
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "unknown";
  const MS_PER_SECOND = 1000;
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / MS_PER_SECOND);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMon = Math.floor(diffDay / 30);
  if (diffMon < 12) return `${diffMon}mo ago`;
  const diffYr = Math.floor(diffMon / 12);
  return `${diffYr}y ago`;
}
