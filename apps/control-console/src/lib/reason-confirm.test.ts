import { afterEach, describe, expect, it } from "@rstest/core";
import {
  requestReasonConfirm,
  resetReasonConfirmQueue,
  settleReasonConfirm,
  subscribeReasonConfirm,
} from "./reason-confirm";

describe("reason confirm", () => {
  afterEach(() => {
    resetReasonConfirmQueue();
  });

  it("returns null when no dialog host is mounted", async () => {
    await expect(requestReasonConfirm("Suspend?")).resolves.toBeNull();
  });

  it("returns the typed reason or null on cancel", async () => {
    subscribeReasonConfirm(() => undefined);
    const accepted = requestReasonConfirm("Suspend?", {
      typed: "vistaremote",
    });
    settleReasonConfirm("partner hold");
    await expect(accepted).resolves.toBe("partner hold");

    const cancelled = requestReasonConfirm("Retire?");
    settleReasonConfirm(null);
    await expect(cancelled).resolves.toBeNull();
  });
});
