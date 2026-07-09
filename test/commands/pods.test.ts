import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/kubectl.js", () => ({
  kubectlJson: vi.fn(),
  kubectlExec: vi.fn(),
  kubectlRaw: vi.fn(),
}));

import { kubectlJson, kubectlExec, kubectlRaw } from "../../src/kubectl.js";
import { podsCommand, PODS_HELP } from "../../src/commands/pods.js";
import type { Pod } from "../../src/podstatus.js";

const mockedJson = vi.mocked(kubectlJson);
const mockedExec = vi.mocked(kubectlExec);
const mockedRaw = vi.mocked(kubectlRaw);

function makePod(overrides: {
  name: string;
  namespace?: string;
  phase?: string;
  ready?: boolean;
  restarts?: number;
  waitingReason?: string;
  lastTerminated?: { reason: string; exitCode: number };
  unschedulable?: boolean;
}): Pod {
  const {
    name,
    namespace = "default",
    phase = "Running",
    ready = true,
    restarts = 0,
    waitingReason,
    lastTerminated,
    unschedulable,
  } = overrides;

  const hasStatuses = !unschedulable;
  return {
    metadata: {
      name,
      namespace,
      creationTimestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    },
    spec: {
      nodeName: unschedulable ? undefined : "node-1",
      containers: [{ name: "app", image: "nginx:1.27-alpine" }],
    },
    status: {
      phase,
      conditions: unschedulable
        ? [
            {
              type: "PodScheduled",
              status: "False",
              reason: "Unschedulable",
              message: "0/1 nodes are available",
            },
          ]
        : [],
      ...(hasStatuses
        ? {
            containerStatuses: [
              {
                name: "app",
                ready,
                restartCount: restarts,
                state: waitingReason
                  ? { waiting: { reason: waitingReason } }
                  : { running: { startedAt: new Date().toISOString() } },
                ...(lastTerminated
                  ? {
                      lastState: {
                        terminated: {
                          reason: lastTerminated.reason,
                          exitCode: lastTerminated.exitCode,
                          finishedAt: new Date().toISOString(),
                        },
                      },
                    }
                  : {}),
              },
            ],
          }
        : {}),
    },
  };
}

describe("podsCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("router", () => {
    it("returns help for --help", async () => {
      const result = await podsCommand(["--help"]);
      expect(result).toBe(PODS_HELP);
    });

    it("suggests view for a stray positional", async () => {
      const result = await podsCommand(["my-pod-abc123"]);
      expect(result).toContain("Unknown subcommand: my-pod-abc123");
      expect(result).toContain("pods view my-pod-abc123");
    });
  });

  describe("list", () => {
    it("lists pods with not-ready sorted first and a count line", async () => {
      mockedJson.mockResolvedValue({
        items: [
          makePod({ name: "healthy-1" }),
          makePod({
            name: "broken-1",
            ready: false,
            restarts: 5,
            waitingReason: "CrashLoopBackOff",
          }),
          makePod({ name: "healthy-2" }),
        ],
      });

      const result = await podsCommand(["list"], {
        namespace: "payments",
        allNamespaces: false,
      });

      expect(result).toContain("count: 3 in namespace payments (1 not ready)");
      expect(result).toContain("CrashLoopBackOff");
      // broken pod sorts before healthy pods
      expect(result.indexOf("broken-1")).toBeLessThan(
        result.indexOf("healthy-1"),
      );
      expect(mockedJson).toHaveBeenCalledWith(
        ["get", "pods", "-o", "json"],
        expect.objectContaining({ namespace: "payments" }),
      );
    });

    it("marks unschedulable pending pods", async () => {
      mockedJson.mockResolvedValue({
        items: [
          makePod({ name: "stuck", phase: "Pending", unschedulable: true }),
        ],
      });

      const result = await podsCommand([], undefined);
      expect(result).toContain("Unschedulable");
      expect(result).toContain("(1 not ready)");
    });

    it("includes namespace column only with -A", async () => {
      mockedJson.mockResolvedValue({
        items: [makePod({ name: "a", namespace: "ns-one" })],
      });

      const result = await podsCommand([], {
        allNamespaces: true,
      });

      expect(result).toContain("namespace");
      expect(result).toContain("ns-one");
      expect(result).toContain("in all namespaces");
    });

    it("emits a definitive empty state when the namespace exists but is empty", async () => {
      mockedJson.mockResolvedValue({ items: [] });
      mockedRaw.mockResolvedValue({
        stdout: "NAME       STATUS   AGE\nempty-ns   Active   1d",
        stderr: "",
        exitCode: 0,
      });

      const result = await podsCommand([], {
        namespace: "empty-ns",
        allNamespaces: false,
      });

      expect(result).toContain("pods: none found in namespace empty-ns");
      expect(result).toContain("pods -A");
      expect(mockedExec).not.toHaveBeenCalled();
    });

    it("reports NOT_FOUND when the namespace itself does not exist", async () => {
      mockedJson.mockResolvedValue({ items: [] });
      mockedRaw.mockResolvedValue({
        stdout: "",
        stderr: 'Error from server (NotFound): namespaces "nope-ns" not found',
        exitCode: 1,
      });

      await expect(
        podsCommand([], { namespace: "nope-ns", allNamespaces: false }),
      ).rejects.toThrow('Namespace "nope-ns" not found');
    });

    it("names the current namespace in empty states", async () => {
      mockedJson.mockResolvedValue({ items: [] });
      mockedExec.mockResolvedValue("team-x");

      const result = await podsCommand([], undefined);

      expect(result).toContain("pods: none found in namespace team-x (current)");
    });

    it("rejects unknown flags before calling kubectl", async () => {
      await expect(podsCommand(["list", "--stat"])).rejects.toThrow(
        "unknown flag --stat",
      );
      expect(mockedJson).not.toHaveBeenCalled();
    });
  });

  describe("view", () => {
    it("requires a pod name", async () => {
      await expect(podsCommand(["view"])).rejects.toThrow(
        "Pod name is required",
      );
    });

    it("rejects -A", async () => {
      await expect(
        podsCommand(["view", "some-pod"], { allNamespaces: true }),
      ).rejects.toThrow("-A/--all-namespaces is not valid");
    });

    it("renders pod, containers with last_state and probe, and sorted events", async () => {
      const pod = makePod({
        name: "cache-abc",
        namespace: "fault-oom",
        ready: false,
        restarts: 4,
        waitingReason: "CrashLoopBackOff",
        lastTerminated: { reason: "OOMKilled", exitCode: 137 },
      });
      pod.spec!.containers![0].readinessProbe = {
        httpGet: { path: "/healthz", port: 8080 },
      };
      pod.spec!.containers![0].resources = { limits: { memory: "25Mi" } };

      const oldTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const newTime = new Date(Date.now() - 60 * 1000).toISOString();
      mockedJson.mockImplementation(async (args: string[]) => {
        if (args.includes("events")) {
          return {
            items: [
              {
                type: "Normal",
                reason: "Scheduled",
                message: "Successfully assigned",
                lastTimestamp: oldTime,
              },
              {
                type: "Warning",
                reason: "BackOff",
                message: "Back-off restarting failed container",
                count: 12,
                lastTimestamp: newTime,
              },
            ],
          };
        }
        return pod;
      });

      const result = await podsCommand(["view", "cache-abc"], {
        namespace: "fault-oom",
        allNamespaces: false,
      });

      expect(result).toContain("name: cache-abc");
      expect(result).toContain("status: CrashLoopBackOff");
      expect(result).toContain("OOMKilled (exit 137");
      expect(result).toContain("http :8080/healthz");
      expect(result).toContain("memory=25Mi");
      // events sorted newest first
      expect(result.indexOf("BackOff")).toBeLessThan(
        result.indexOf("Scheduled"),
      );
    });

    it("shows scheduling constraints for an unschedulable pod", async () => {
      const pod = makePod({
        name: "search-indexer",
        namespace: "fault-unschedulable",
        phase: "Pending",
        unschedulable: true,
      });
      pod.spec!.nodeSelector = { disktype: "ssd-nvme-gen5" };

      mockedJson.mockImplementation(async (args: string[]) => {
        if (args.includes("events")) return { items: [] };
        return pod;
      });

      const result = await podsCommand(["view", "search-indexer"], {
        namespace: "fault-unschedulable",
        allNamespaces: false,
      });

      expect(result).toContain("scheduling:");
      expect(result).toContain("node_selector: disktype=ssd-nvme-gen5");
      expect(result).toContain("0/1 nodes are available");
    });

    it("prints a definitive line when the pod has no events", async () => {
      mockedJson.mockImplementation(async (args: string[]) => {
        if (args.includes("events")) {
          return { items: [] };
        }
        return makePod({ name: "quiet-pod" });
      });

      const result = await podsCommand(["view", "quiet-pod"]);
      expect(result).toContain("events: none recorded for this pod");
    });
  });
});
