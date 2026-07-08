import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/kubectl.js", () => ({
  kubectlJson: vi.fn(),
  kubectlExec: vi.fn(),
  kubectlRaw: vi.fn(),
}));

import { kubectlJson } from "../../src/kubectl.js";
import { eventsCommand, EVENTS_HELP } from "../../src/commands/events.js";

const mockedJson = vi.mocked(kubectlJson);

function event(overrides: {
  reason: string;
  type?: string;
  minutesAgo: number;
  name?: string;
}) {
  return {
    type: overrides.type ?? "Normal",
    reason: overrides.reason,
    message: `msg ${overrides.reason}`,
    count: 1,
    lastTimestamp: new Date(
      Date.now() - overrides.minutesAgo * 60 * 1000,
    ).toISOString(),
    involvedObject: { kind: "Pod", name: overrides.name ?? "pod-1" },
  };
}

describe("eventsCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns help for --help", async () => {
    expect(await eventsCommand(["--help"])).toBe(EVENTS_HELP);
  });

  it("sorts newest first regardless of API order", async () => {
    mockedJson.mockResolvedValue({
      items: [
        event({ reason: "Older", minutesAgo: 50 }),
        event({ reason: "Newest", minutesAgo: 1 }),
        event({ reason: "Middle", minutesAgo: 10 }),
      ],
    });

    const result = await eventsCommand([]);

    expect(result.indexOf("Newest")).toBeLessThan(result.indexOf("Middle"));
    expect(result.indexOf("Middle")).toBeLessThan(result.indexOf("Older"));
  });

  it("filters to warnings with --warnings and counts them", async () => {
    mockedJson.mockResolvedValue({
      items: [
        event({ reason: "BackOff", type: "Warning", minutesAgo: 2 }),
        event({ reason: "Pulled", minutesAgo: 3 }),
      ],
    });

    const result = await eventsCommand(["--warnings"]);

    expect(result).toContain("BackOff");
    expect(result).not.toContain("Pulled");
    expect(result).toContain("count: 1");
  });

  it("notes display truncation against --limit", async () => {
    mockedJson.mockResolvedValue({
      items: Array.from({ length: 5 }, (_, i) =>
        event({ reason: `R${i}`, minutesAgo: i }),
      ),
    });

    const result = await eventsCommand(["--limit", "2"]);

    expect(result).toContain("showing newest 2");
  });

  it("emits a definitive empty state", async () => {
    mockedJson.mockResolvedValue({ items: [] });

    const result = await eventsCommand([], {
      namespace: "quiet",
      allNamespaces: false,
    });

    expect(result).toContain("events: none found in namespace quiet");
  });

  it("rejects unknown flags", async () => {
    await expect(eventsCommand(["--sort-by", "x"])).rejects.toThrow(
      "unknown flag --sort-by",
    );
  });
});
