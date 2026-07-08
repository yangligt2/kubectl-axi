import { describe, it, expect } from "vitest";
import {
  describeScope,
  parseKubeArgs,
  validateKubeScope,
} from "../src/context.js";

describe("parseKubeArgs", () => {
  it("strips -n and returns the namespace", () => {
    const { ctx, strippedArgs } = parseKubeArgs(["list", "-n", "payments"]);
    expect(ctx.namespace).toBe("payments");
    expect(strippedArgs).toEqual(["list"]);
  });

  it("supports --namespace= and --context=", () => {
    const { ctx, strippedArgs } = parseKubeArgs([
      "view",
      "pod-1",
      "--namespace=web",
      "--context=kind-bench",
    ]);
    expect(ctx.namespace).toBe("web");
    expect(ctx.context).toBe("kind-bench");
    expect(strippedArgs).toEqual(["view", "pod-1"]);
  });

  it("recognizes -A and --all-namespaces", () => {
    expect(parseKubeArgs(["-A"]).ctx.allNamespaces).toBe(true);
    expect(parseKubeArgs(["--all-namespaces"]).ctx.allNamespaces).toBe(true);
  });

  it("never throws on contradictory flags (validation is separate)", () => {
    const { ctx } = parseKubeArgs(["-n", "x", "-A"]);
    expect(() => validateKubeScope(ctx)).toThrow("cannot be combined");
  });
});

describe("describeScope", () => {
  it("names the scope", () => {
    expect(describeScope({ allNamespaces: true })).toBe("all namespaces");
    expect(describeScope({ namespace: "x", allNamespaces: false })).toBe(
      "namespace x",
    );
    expect(describeScope(undefined)).toBe("the current namespace");
  });
});
