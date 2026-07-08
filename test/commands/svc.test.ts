import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/kubectl.js", () => ({
  kubectlJson: vi.fn(),
  kubectlExec: vi.fn(),
  kubectlRaw: vi.fn(),
}));

import { kubectlJson } from "../../src/kubectl.js";
import { svcCommand } from "../../src/commands/svc.js";

const mockedJson = vi.mocked(kubectlJson);

describe("svcCommand view", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("diagnoses a selector matching zero pods", async () => {
    mockedJson.mockImplementation(async (args: string[]) => {
      if (args[1] === "service") {
        return {
          metadata: { name: "web", namespace: "shop" },
          spec: {
            selector: { app: "web-v2" },
            ports: [{ port: 80 }],
            clusterIP: "10.96.0.10",
          },
        };
      }
      if (args[1] === "endpoints") {
        return { metadata: { name: "web", namespace: "shop" }, subsets: [] };
      }
      return { items: [] }; // pods -l
    });

    const result = await svcCommand(["view", "web"], {
      namespace: "shop",
      allNamespaces: false,
    });

    expect(result).toContain("endpoints_ready: 0");
    expect(result).toContain('selector "app=web-v2" matches 0 pods');
    expect(mockedJson).toHaveBeenCalledWith(
      ["get", "pods", "-l", "app=web-v2", "-o", "json"],
      expect.objectContaining({ namespace: "shop" }),
    );
  });

  it("points at unready pods when the selector matches but nothing is ready", async () => {
    mockedJson.mockImplementation(async (args: string[]) => {
      if (args[1] === "service") {
        return {
          metadata: { name: "api", namespace: "shop" },
          spec: { selector: { app: "api" }, ports: [{ port: 80 }] },
        };
      }
      if (args[1] === "endpoints") {
        return { metadata: { name: "api", namespace: "shop" }, subsets: [] };
      }
      return {
        items: [
          {
            metadata: { name: "api-1", namespace: "shop" },
            spec: { containers: [{ name: "api" }] },
            status: {
              phase: "Running",
              containerStatuses: [
                {
                  name: "api",
                  ready: false,
                  restartCount: 3,
                  state: { waiting: { reason: "CrashLoopBackOff" } },
                },
              ],
            },
          },
        ],
      };
    });

    const result = await svcCommand(["view", "api"], {
      namespace: "shop",
      allNamespaces: false,
    });

    expect(result).toContain("matching_pods");
    expect(result).toContain("fix the pods, not the service");
    expect(result).toContain("pods view api-1");
  });

  it("lists services with backend readiness inline", async () => {
    mockedJson.mockImplementation(async (args: string[]) => {
      if (args[1] === "services") {
        return {
          items: [
            {
              metadata: { name: "good", namespace: "shop" },
              spec: { selector: { app: "good" }, ports: [{ port: 80 }] },
            },
            {
              metadata: { name: "broken", namespace: "shop" },
              spec: { selector: { app: "broken" }, ports: [{ port: 80 }] },
            },
          ],
        };
      }
      return {
        items: [
          {
            metadata: { name: "good", namespace: "shop" },
            subsets: [{ addresses: [{ ip: "10.0.0.1" }] }],
          },
          { metadata: { name: "broken", namespace: "shop" }, subsets: [] },
        ],
      };
    });

    const result = await svcCommand([], { namespace: "shop", allNamespaces: false });

    expect(result).toContain("1 without ready backends");
    expect(result).toContain("NONE");
    // broken sorts first
    expect(result.indexOf("broken")).toBeLessThan(result.indexOf("good"));
  });
});
