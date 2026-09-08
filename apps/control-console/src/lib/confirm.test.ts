import { describe, expect, it, vi } from "vitest";
import { confirmDestructive } from "./confirm";

describe("destructive confirmation", () => {
  it("requires window.confirm for ordinary destructive actions", async () => {
    const confirm = vi.fn(() => true);
    await expect(confirmDestructive("Refund?", { confirm })).resolves.toBe(
      true,
    );
    expect(confirm).toHaveBeenCalledWith("Refund?");
    const deny = vi.fn(() => false);
    await expect(
      confirmDestructive("Refund?", { confirm: deny }),
    ).resolves.toBe(false);
  });

  it("requires typing ENABLE before enabling a provider", async () => {
    const prompt = vi.fn(() => "ENABLE");
    await expect(
      confirmDestructive("Enable?", { typed: "ENABLE", prompt }),
    ).resolves.toBe(true);
    const wrong = vi.fn(() => "yes");
    await expect(
      confirmDestructive("Enable?", { typed: "ENABLE", prompt: wrong }),
    ).resolves.toBe(false);
  });
});
