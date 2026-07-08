import { describe, it, expect } from "vitest";
import { validateFlags } from "../src/args.js";
import { AxiError } from "../src/errors.js";

describe("validateFlags", () => {
  it("accepts known value flags in space and equals form", () => {
    expect(() =>
      validateFlags(
        "logs",
        ["my-pod", "--tail", "50", "--container=web"],
        { valueFlags: ["--tail", "--container"] },
        "--tail, --container",
      ),
    ).not.toThrow();
  });

  it("accepts known boolean flags and --help", () => {
    expect(() =>
      validateFlags(
        "logs",
        ["--previous", "--help"],
        { boolFlags: ["--previous"] },
        "--previous",
      ),
    ).not.toThrow();
  });

  it("rejects unknown flags with the valid list", () => {
    try {
      validateFlags("pods list", ["--stat", "closed"], {}, "-n, -A");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      const axiError = error as AxiError;
      expect(axiError.code).toBe("VALIDATION_ERROR");
      expect(axiError.message).toContain("unknown flag --stat");
      expect(axiError.suggestions[0]).toContain("valid flags for `pods list`");
    }
  });

  it("names only the flag, not its =value", () => {
    expect(() => validateFlags("x", ["--foo=bar"], {}, "none")).toThrow(
      "unknown flag --foo",
    );
  });
});
