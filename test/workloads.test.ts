import { describe, it, expect } from "vitest";
import {
  deploymentHealth,
  endpointCounts,
  nodeIssues,
  portSummary,
  pvcPending,
  selectorExpression,
} from "../src/workloads.js";

describe("deploymentHealth", () => {
  it("reports healthy when ready == desired and progressing", () => {
    const health = deploymentHealth({
      metadata: { name: "d" },
      spec: { replicas: 2 },
      status: {
        readyReplicas: 2,
        conditions: [{ type: "Progressing", status: "True" }],
      },
    });
    expect(health).toEqual({ ready: "2/2", healthy: true, reason: "OK" });
  });

  it("flags stuck rollouts even when old replicas keep ready == desired", () => {
    const health = deploymentHealth({
      metadata: { name: "checkout" },
      spec: { replicas: 3 },
      status: {
        readyReplicas: 3,
        conditions: [
          {
            type: "Progressing",
            status: "False",
            reason: "ProgressDeadlineExceeded",
          },
        ],
      },
    });
    expect(health.healthy).toBe(false);
    expect(health.reason).toBe("ProgressDeadlineExceeded");
  });

  it("flags below-desired deployments", () => {
    const health = deploymentHealth({
      metadata: { name: "d" },
      spec: { replicas: 3 },
      status: { readyReplicas: 1 },
    });
    expect(health.healthy).toBe(false);
    expect(health.ready).toBe("1/3");
  });
});

describe("nodeIssues", () => {
  it("returns nothing for a healthy node", () => {
    expect(
      nodeIssues({
        metadata: { name: "n" },
        status: {
          conditions: [
            { type: "Ready", status: "True" },
            { type: "MemoryPressure", status: "False" },
          ],
        },
      }),
    ).toEqual([]);
  });

  it("flags NotReady and pressure conditions", () => {
    const issues = nodeIssues({
      metadata: { name: "n" },
      status: {
        conditions: [
          { type: "Ready", status: "False", message: "kubelet down" },
          { type: "DiskPressure", status: "True", reason: "LowDisk" },
        ],
      },
    });
    expect(issues).toHaveLength(2);
    expect(issues[0].condition).toBe("Ready");
    expect(issues[1].condition).toBe("DiskPressure");
  });
});

describe("service helpers", () => {
  it("counts ready and not-ready endpoint addresses", () => {
    expect(
      endpointCounts({
        metadata: { name: "s" },
        subsets: [
          {
            addresses: [{ ip: "10.0.0.1" }, { ip: "10.0.0.2" }],
            notReadyAddresses: [{ ip: "10.0.0.3" }],
          },
        ],
      }),
    ).toEqual({ ready: 2, notReady: 1 });
    expect(endpointCounts(undefined)).toEqual({ ready: 0, notReady: 0 });
  });

  it("renders selectors and ports compactly", () => {
    expect(selectorExpression({ app: "web", tier: "api" })).toBe(
      "app=web,tier=api",
    );
    expect(selectorExpression(undefined)).toBeUndefined();
    expect(
      portSummary({
        metadata: { name: "s" },
        spec: { ports: [{ port: 80, targetPort: 8080 }, { port: 443 }] },
      }),
    ).toBe("80->8080,443");
  });
});

describe("pvcPending", () => {
  it("treats anything not Bound as pending", () => {
    expect(
      pvcPending({ metadata: { name: "p" }, status: { phase: "Bound" } }),
    ).toBe(false);
    expect(
      pvcPending({ metadata: { name: "p" }, status: { phase: "Pending" } }),
    ).toBe(true);
  });
});
