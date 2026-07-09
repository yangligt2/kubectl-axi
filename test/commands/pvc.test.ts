import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/kubectl.js", () => ({
  kubectlJson: vi.fn(),
  kubectlExec: vi.fn(),
  kubectlRaw: vi.fn(),
}));

import { kubectlJson, kubectlRaw } from "../../src/kubectl.js";
import { pvcCommand } from "../../src/commands/pvc.js";

const mockedJson = vi.mocked(kubectlJson);
const mockedRaw = vi.mocked(kubectlRaw);

describe("pvcCommand view", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("diagnoses a nonexistent storage class without raw kubectl", async () => {
    mockedJson.mockImplementation(async (args: string[]) => {
      if (args[1] === "pvc") {
        return {
          metadata: { name: "data-cache", namespace: "fault-pvc" },
          spec: {
            storageClassName: "fast-ssd",
            resources: { requests: { storage: "1Gi" } },
          },
          status: { phase: "Pending" },
        };
      }
      if (args[1] === "pods") {
        return {
          items: [
            {
              metadata: { name: "db-1", namespace: "fault-pvc" },
              spec: {
                volumes: [{ persistentVolumeClaim: { claimName: "data-cache" } }],
              },
            },
          ],
        };
      }
      return { items: [] }; // events
    });
    // storageclass fast-ssd does not exist
    mockedRaw.mockResolvedValue({ stdout: "", stderr: "not found", exitCode: 1 });

    const result = await pvcCommand(["view", "data-cache"], {
      namespace: "fault-pvc",
      allNamespaces: false,
    });

    expect(result).toContain("phase: Pending");
    expect(result).toContain("storageclass: fast-ssd");
    expect(result).toContain('storage class "fast-ssd" does not exist');
    expect(result).toContain("mounted_by: db-1");
    expect(mockedRaw).toHaveBeenCalledWith(
      ["get", "storageclass", "fast-ssd"],
      undefined,
    );
  });

  it("does not flag a bound PVC with an existing storage class", async () => {
    mockedJson.mockImplementation(async (args: string[]) => {
      if (args[1] === "pvc") {
        return {
          metadata: { name: "ok", namespace: "shop" },
          spec: { storageClassName: "standard", volumeName: "pv-123" },
          status: { phase: "Bound" },
        };
      }
      return { items: [] };
    });
    mockedRaw.mockResolvedValue({ stdout: "standard", stderr: "", exitCode: 0 });

    const result = await pvcCommand(["view", "ok"], {
      namespace: "shop",
      allNamespaces: false,
    });

    expect(result).toContain("phase: Bound");
    expect(result).not.toContain("does not exist");
  });

  it("sorts pending PVCs first in list", async () => {
    mockedJson.mockResolvedValue({
      items: [
        {
          metadata: { name: "bound-one", namespace: "shop" },
          spec: { storageClassName: "standard" },
          status: { phase: "Bound" },
        },
        {
          metadata: { name: "stuck-one", namespace: "shop" },
          spec: { storageClassName: "fast-ssd" },
          status: { phase: "Pending" },
        },
      ],
    });

    const result = await pvcCommand([], { namespace: "shop", allNamespaces: false });

    expect(result).toContain("(1 pending)");
    expect(result.indexOf("stuck-one")).toBeLessThan(result.indexOf("bound-one"));
  });
});
