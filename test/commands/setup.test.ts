import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("axi-sdk-js", async (importOriginal) => {
  const original = await importOriginal<typeof import("axi-sdk-js")>();
  return {
    ...original,
    installSessionStartHooks: vi.fn(),
  };
});

import { installSessionStartHooks } from "axi-sdk-js";
import { setupCommand } from "../../src/commands/setup.js";

const mockedInstall = vi.mocked(installSessionStartHooks);

describe("setupCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects unknown actions", async () => {
    await expect(setupCommand(["everything"])).rejects.toThrow(
      "Unknown setup action",
    );
    expect(mockedInstall).not.toHaveBeenCalled();
  });

  it("installs hooks pointing at the kubeconfig-only ctx entrypoint", async () => {
    const result = await setupCommand(["hooks"]);

    expect(mockedInstall).toHaveBeenCalledOnce();
    const options = mockedInstall.mock.calls[0][0]!;
    expect(options.marker).toBe("kubectl-axi");
    expect(options.binaryNames).toEqual(["kubectl-axi-ctx"]);
    expect(options.execPath).toContain("kubectl-axi-ctx");
    expect(result).toContain("no cluster calls");
    expect(result).toContain("Restart your agent session");
  });

  it("surfaces installer errors instead of claiming success", async () => {
    mockedInstall.mockImplementation((options) => {
      options?.onError?.("~/.claude/settings.json: permission denied");
    });

    await expect(setupCommand(["hooks"])).rejects.toThrow(
      "permission denied",
    );
  });
});
