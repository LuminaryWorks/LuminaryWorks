import { getQuotaPack, ONCE_GRANTS, QUOTA_PACK_SKUS } from "../src/common/voice-packs";

describe("voice packs", () => {
  it("does not treat signup seconds as the 7-day product trial", () => {
    expect(
      ONCE_GRANTS["ai.voice.signup.300s"]?.features["ai.voice.trial.seconds"]?.limitValue,
    ).toBe(300);
    expect(ONCE_GRANTS["ai.voice.signup.300s"]?.features["ai.voice"]).toEqual({ effect: "allow" });
  });

  it("fulfills packs as second grants not Pro plans", () => {
    const pack = getQuotaPack("blockyedu.voice.pack.1800s");
    expect(pack?.seconds).toBe(1800);
    expect(pack?.featureCode).toBe("ai.voice.purchased.seconds");
    expect(Object.values(QUOTA_PACK_SKUS).every((item) => item.productCode === "blockyedu")).toBe(
      true,
    );
  });
});
