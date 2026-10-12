import { describe, expect, it } from "@rstest/core";
import {
  CATALOG_CHANNEL_IDS,
  type CatalogConfig,
  CHECKOUT_CHANNEL_IDS,
  canSaveChannel,
  channelPhase,
  credentialWriteMode,
  enableNeedsSetup,
  priorityForIndex,
  reorderVisibleCatalog,
  representativeConfig,
  resolveCatalogOrder,
} from "./channel-catalog";

function row(
  patch: Partial<CatalogConfig> & Pick<CatalogConfig, "id">,
): CatalogConfig {
  return {
    providerId: "stripe_checkout",
    environment: "sandbox",
    enabled: false,
    priority: 100,
    credentialFingerprint: "fp",
    lastTestOk: null,
    lastTestEnvironment: null,
    lastTestFingerprint: "",
    ...patch,
  };
}

describe("channel catalog", () => {
  it("starts from the fixed checkout list and keeps unknown ids out", () => {
    expect(CHECKOUT_CHANNEL_IDS).toEqual([
      "alipay_f2f",
      "paypal",
      "wechat_pay_v3",
      "unionpay_quickpass",
      "stripe_checkout",
      "coinbase_commerce",
      "okx_onchain",
      "bitpay",
      "doerflow_credit",
    ]);
    expect(
      resolveCatalogOrder(["stripe_checkout", "nope", "stripe_checkout"])[0],
    ).toBe("stripe_checkout");
    expect(resolveCatalogOrder(null)).toEqual([...CATALOG_CHANNEL_IDS]);
    expect(CATALOG_CHANNEL_IDS).not.toContain("manual");
    expect(CATALOG_CHANNEL_IDS).not.toContain("contract");
    expect(resolveCatalogOrder(["paypal"])).toContain("alipay_f2f");
  });

  it("swaps a visible channel without pulling hidden rows into that slot", () => {
    const order = resolveCatalogOrder(null);
    const visible = order.filter((id) =>
      (CHECKOUT_CHANNEL_IDS as readonly string[]).includes(id),
    );
    const next = reorderVisibleCatalog(order, visible, "paypal", "alipay_f2f");
    expect(next[0]).toBe("paypal");
    expect(next[1]).toBe("alipay_f2f");
    expect(next.indexOf("creem")).toBeGreaterThan(
      next.indexOf("doerflow_credit"),
    );
    expect(priorityForIndex(0)).toBe(10);
  });

  it("blocks enable until configuration and a matching test exist", () => {
    expect(channelPhase("stripe_checkout", null)).toBe("unconfigured");
    expect(enableNeedsSetup("stripe_checkout", null)).toBe(true);
    const saved = row({ id: "1" });
    expect(channelPhase("stripe_checkout", saved)).toBe("needs_test");
    const tested = row({
      id: "1",
      lastTestOk: true,
      lastTestEnvironment: "sandbox",
      lastTestFingerprint: "fp",
    });
    expect(channelPhase("stripe_checkout", tested)).toBe("ready");
    expect(enableNeedsSetup("stripe_checkout", tested)).toBe(false);
    expect(channelPhase("stripe_checkout", { ...tested, enabled: true })).toBe(
      "enabled",
    );
    expect(
      channelPhase(
        "manual",
        row({ id: "m", providerId: "manual", credentialFingerprint: "" }),
      ),
    ).toBe("needs_test");
  });

  it("picks the enabled config ahead of a newer sandbox row", () => {
    const chosen = representativeConfig(
      [
        row({ id: "sandbox", environment: "sandbox", priority: 10 }),
        row({ id: "live", environment: "live", enabled: true, priority: 40 }),
      ],
      "stripe_checkout",
    );
    expect(chosen?.id).toBe("live");
  });

  it("requires a full credential set before the first save", () => {
    expect(
      credentialWriteMode("stripe_checkout", { secretKey: "sk_test_123" }),
    ).toBe("partial");
    expect(canSaveChannel("stripe_checkout", {}, false)).toBe(false);
    expect(
      canSaveChannel(
        "stripe_checkout",
        { secretKey: "sk_test_123456", webhookSecret: "whsec_123456" },
        false,
      ),
    ).toBe(true);
    expect(canSaveChannel("stripe_checkout", {}, true)).toBe(true);
    expect(
      canSaveChannel(
        "alipay_f2f",
        { appId: "9021000168692418", notifyUrl: "https://luminaryworks.dev/notify" },
        true,
      ),
    ).toBe(true);
    expect(
      canSaveChannel("alipay_f2f", { merchantPrivateKey: "partial" }, true),
    ).toBe(false);
    expect(canSaveChannel("manual", {}, false)).toBe(true);
  });
});
