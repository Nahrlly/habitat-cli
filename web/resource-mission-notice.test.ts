import { describe, expect, test } from "bun:test";
import { formatOpenClawMissionNotice, formatResourceMissionReturnNotice } from "./resource-mission-notice";

describe("resource mission notices", () => {
  test("describes the response returned by OpenClaw", () => {
    expect(formatOpenClawMissionNotice({
      id: "iteration-1",
      action: "plan",
      actionInput: {
        source: "openclaw",
        responseText: '[{"type":"deploy","humanId":"human-1"},{"type":"scan","strength":50,"radius":1},{"type":"collect","quantityKg":8}]',
      },
      error: null,
    })).toBe("OpenClaw returned: deploy human-1 -> scan strength 50 radius 1 -> collect 8 kg");
  });

  test("describes an OpenClaw planning error", () => {
    expect(formatOpenClawMissionNotice({
      id: "iteration-2",
      action: "plan",
      actionInput: { source: "openclaw" },
      error: "OpenClaw unavailable",
    })).toBe("OpenClaw returned an error: OpenClaw unavailable");
  });

  test("names resources brought back when the mission completes", () => {
    expect(formatResourceMissionReturnNotice({
      status: "completed",
      collectedResources: [
        { resourceId: "ferrite", displayName: "Ferrite", quantityKg: 8 },
        { resourceId: "ice-regolith", quantityKg: 3 },
      ],
    })).toBe("OpenClaw returned with: 8 kg Ferrite, 3 kg ice-regolith");
  });
});
