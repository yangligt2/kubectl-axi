import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/kubectl.js", () => ({
  kubectlJson: vi.fn(),
  kubectlExec: vi.fn(),
  kubectlRaw: vi.fn(),
}));

import { kubectlJson } from "../../src/kubectl.js";
import { triageCommand } from "../../src/commands/triage.js";

const mockedJson = vi.mocked(kubectlJson);

const brokenPod = {
  metadata: { name: "api-1", namespace: "fault-crashloop" },
  spec: { containers: [{ name: "api" }] },
  status: {
    phase: "Running",
    containerStatuses: [
      {
        name: "api",
        ready: false,
        restartCount: 9,
        state: { waiting: { reason: "CrashLoopBackOff" } },
      },
    ],
  },
};

const healthyPod = {
  metadata: { name: "ok-1", namespace: "healthy" },
  spec: { containers: [{ name: "app" }] },
  status: {
    phase: "Running",
    containerStatuses: [
      { name: "app", ready: true, restartCount: 0, state: { running: {} } },
    ],
  },
};

const stuckDeploy = {
  metadata: { name: "checkout", namespace: "fault-rollout" },
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
};

const pendingPvc = {
  metadata: { name: "data-cache", namespace: "fault-pvc" },
  spec: { storageClassName: "fast-ssd" },
  status: { phase: "Pending" },
};

const selectorSvc = {
  metadata: { name: "web", namespace: "fault-endpoints" },
  spec: { selector: { app: "web-backend-v2" }, ports: [{ port: 80 }] },
};

const emptyEndpoints = {
  metadata: { name: "web", namespace: "fault-endpoints" },
  subsets: [],
};

const healthyNode = {
  metadata: { name: "cp-1" },
  status: {
    conditions: [
      { type: "Ready", status: "True" },
      { type: "MemoryPressure", status: "False" },
    ],
  },
};

const recentWarning = {
  type: "Warning",
  reason: "BackOff",
  message: "Back-off restarting failed container",
  count: 42,
  lastTimestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  involvedObject: { kind: "Pod", name: "api-1", namespace: "fault-crashloop" },
};

function mockCluster(overrides?: {
  failDeployments?: boolean;
  healthyOnly?: boolean;
}) {
  mockedJson.mockImplementation(async (args: string[]) => {
    const resource = args[1];
    if (overrides?.failDeployments && resource === "deployments") {
      throw new Error("forbidden");
    }
    if (overrides?.healthyOnly) {
      switch (resource) {
        case "pods":
          return { items: [healthyPod] };
        case "nodes":
          return { items: [healthyNode] };
        default:
          return { items: [] };
      }
    }
    switch (resource) {
      case "pods":
        return { items: [brokenPod, healthyPod] };
      case "deployments":
        return { items: [stuckDeploy] };
      case "pvc":
        return { items: [pendingPvc] };
      case "services":
        return { items: [selectorSvc] };
      case "endpoints":
        return { items: [emptyEndpoints] };
      case "nodes":
        return { items: [healthyNode] };
      case "events":
        return { items: [recentWarning] };
      default:
        return { items: [] };
    }
  });
}

describe("triageCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("aggregates all issue classes in one call", async () => {
    mockCluster();

    const result = await triageCommand([]);

    expect(result).toContain("triage: 4 issues found in all namespaces");
    expect(result).toContain("not_ready_pods");
    expect(result).toContain("CrashLoopBackOff");
    expect(result).toContain("degraded_deployments");
    expect(result).toContain("ProgressDeadlineExceeded");
    expect(result).toContain("pending_pvcs");
    expect(result).toContain("fast-ssd");
    expect(result).toContain("services_without_endpoints");
    expect(result).toContain("app=web-backend-v2");
    expect(result).toContain("recent_warnings");
    expect(result).not.toContain("node_issues");
    // healthy pod is not listed
    expect(result).not.toContain("ok-1");
  });

  it("defaults to all namespaces but honors -n scoping", async () => {
    mockCluster();

    await triageCommand([], {
      namespace: "fault-pvc",
      allNamespaces: false,
    });

    expect(mockedJson).toHaveBeenCalledWith(
      ["get", "pods", "-o", "json"],
      expect.objectContaining({ namespace: "fault-pvc", allNamespaces: false }),
    );
    // nodes stay cluster-scoped even with -n
    const nodesCall = mockedJson.mock.calls.find(
      (call) => (call[0] as string[])[1] === "nodes",
    );
    expect(nodesCall).toBeDefined();
    expect((nodesCall?.[1] as { namespace?: string } | undefined)?.namespace).toBeUndefined();
  });

  it("gives a definitive all-healthy answer", async () => {
    mockCluster({ healthyOnly: true });

    const result = await triageCommand([]);

    expect(result).toContain("triage: no issues found in all namespaces");
    expect(result).toContain("nodes are healthy");
  });

  it("degrades gracefully when a check fails, and says so", async () => {
    mockCluster({ failDeployments: true });

    const result = await triageCommand([]);

    expect(result).toContain("checks skipped (query failed): deployments");
    // other findings still present
    expect(result).toContain("not_ready_pods");
  });

  it("rejects unknown flags", async () => {
    await expect(triageCommand(["--all"])).rejects.toThrow(
      "unknown flag --all",
    );
  });
});
