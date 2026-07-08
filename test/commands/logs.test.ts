import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/kubectl.js", () => ({
  kubectlJson: vi.fn(),
  kubectlExec: vi.fn(),
  kubectlRaw: vi.fn(),
}));

import { kubectlJson, kubectlExec } from "../../src/kubectl.js";
import { logsCommand, LOGS_HELP } from "../../src/commands/logs.js";
import type { Pod } from "../../src/podstatus.js";

const mockedJson = vi.mocked(kubectlJson);
const mockedExec = vi.mocked(kubectlExec);

function makePod(containers: Array<{ name: string; restarts?: number; waiting?: string }>): Pod {
  return {
    metadata: { name: "web-abc", namespace: "shop" },
    spec: { containers: containers.map((c) => ({ name: c.name })) },
    status: {
      phase: "Running",
      containerStatuses: containers.map((c) => ({
        name: c.name,
        ready: !c.waiting,
        restartCount: c.restarts ?? 0,
        state: c.waiting
          ? { waiting: { reason: c.waiting } }
          : { running: { startedAt: new Date().toISOString() } },
        ...(c.restarts
          ? {
              lastState: {
                terminated: {
                  reason: "Error",
                  exitCode: 1,
                  finishedAt: new Date().toISOString(),
                },
              },
            }
          : {}),
      })),
    },
  };
}

describe("logsCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns help for --help", async () => {
    expect(await logsCommand(["--help"])).toBe(LOGS_HELP);
  });

  it("requires a pod name", async () => {
    await expect(logsCommand([])).rejects.toThrow("Pod name is required");
  });

  it("auto-selects the single container and tails 100 by default", async () => {
    mockedJson.mockResolvedValue(makePod([{ name: "app" }]));
    mockedExec.mockResolvedValue("line1\nline2\n");

    const result = await logsCommand(["web-abc"]);

    expect(mockedExec).toHaveBeenCalledWith(
      ["logs", "web-abc", "-c", "app", "--tail=100"],
      undefined,
    );
    expect(result).toContain("container: app (pod web-abc, namespace shop)");
    expect(result).toContain("line1");
  });

  it("fails loud on multi-container pods, naming the broken one", async () => {
    mockedJson.mockResolvedValue(
      makePod([
        { name: "web" },
        { name: "log-shipper", restarts: 7, waiting: "CrashLoopBackOff" },
      ]),
    );

    await expect(logsCommand(["web-abc"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      suggestions: expect.arrayContaining([
        expect.stringContaining("-c log-shipper"),
      ]),
    });
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("rejects an unknown container with the container list", async () => {
    mockedJson.mockResolvedValue(makePod([{ name: "app" }]));

    await expect(logsCommand(["web-abc", "-c", "nope"])).rejects.toThrow(
      'Container "nope" not found',
    );
  });

  it("rejects --previous when the container never restarted", async () => {
    mockedJson.mockResolvedValue(makePod([{ name: "app" }]));

    await expect(logsCommand(["web-abc", "--previous"])).rejects.toThrow(
      "no previous run",
    );
  });

  it("hints at --previous when the container has restarted", async () => {
    mockedJson.mockResolvedValue(makePod([{ name: "app", restarts: 4 }]));
    mockedExec.mockResolvedValue("FATAL: db down\n");

    const result = await logsCommand(["web-abc"], {
      namespace: "shop",
      allNamespaces: false,
    });

    expect(result).toContain("restarted 4x");
    expect(result).toContain("--previous");
  });

  it("caps oversized output and reports total size", async () => {
    mockedJson.mockResolvedValue(makePod([{ name: "app" }]));
    mockedExec.mockResolvedValue("x".repeat(30_000));

    const result = await logsCommand(["web-abc"]);

    expect(result).toContain("truncated to 20000 of 30000 chars");
  });

  it("reports empty logs definitively", async () => {
    mockedJson.mockResolvedValue(makePod([{ name: "app" }]));
    mockedExec.mockResolvedValue("");

    const result = await logsCommand(["web-abc"]);

    expect(result).toContain("empty - this run has produced no output");
  });

  it("rejects unknown flags", async () => {
    mockedJson.mockResolvedValue(makePod([{ name: "app" }]));
    await expect(logsCommand(["web-abc", "--folow"])).rejects.toThrow(
      "unknown flag --folow",
    );
  });
});
