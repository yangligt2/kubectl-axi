import { AxiError } from "./errors.js";

function flagEqualsPrefix(flag: string): string {
  return `${flag}=`;
}

/** Get a flag's value from --flag value or --flag=value without modifying args. */
export function getFlag(args: string[], name: string): string | undefined {
  const equalsPrefix = flagEqualsPrefix(name);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === name) {
      if (i + 1 >= args.length) return undefined;
      return args[i + 1];
    }
    if (arg.startsWith(equalsPrefix)) {
      return arg.slice(equalsPrefix.length);
    }
  }
  return undefined;
}

/** Check if a boolean flag is present. */
export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

/** Get the first positional arg (non-flag) starting from startIndex. */
export function getPositional(
  args: string[],
  startIndex: number,
): string | undefined {
  for (let i = startIndex; i < args.length; i++) {
    if (!args[i].startsWith("-")) return args[i];
  }
  return undefined;
}

/**
 * Per-subcommand flag sets for fail-loud validation (AXI P6).
 * Context globals (-n/--namespace, -A/--all-namespaces, --context) are
 * stripped by the CLI layer before handlers run, so they never appear here.
 */
export interface KnownFlags {
  /** Flags that take a value (space or equals form). */
  valueFlags?: string[];
  /** Boolean flags. */
  boolFlags?: string[];
}

/**
 * Reject unknown flags by name, listing the subcommand's valid flags.
 * `--help` always passes. Throws VALIDATION_ERROR (exit 2) before any
 * kubectl call is made.
 */
export function validateFlags(
  command: string,
  args: string[],
  known: KnownFlags,
  validSummary: string,
): void {
  const valueFlags = known.valueFlags ?? [];
  const boolFlags = known.boolFlags ?? [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("-")) continue;
    if (arg === "--help") continue;
    if (boolFlags.includes(arg)) continue;

    const valueFlag = valueFlags.find(
      (f) => arg === f || arg.startsWith(flagEqualsPrefix(f)),
    );
    if (valueFlag) {
      if (arg === valueFlag) i++; // skip the space-form value
      continue;
    }

    const bare = arg.split("=")[0];
    throw new AxiError(
      `unknown flag ${bare} for \`${command}\``,
      "VALIDATION_ERROR",
      [`valid flags for \`${command}\`: ${validSummary} (--help always allowed)`],
    );
  }
}
