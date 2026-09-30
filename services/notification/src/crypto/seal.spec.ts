import { openJson, sealJson, safeEqualString } from "./seal";

describe("credential seal", () => {
  it("round-trips provider credentials and rejects a different passphrase", () => {
    const sealed = sealJson({ provider: "resend", apiKey: "re_test" }, "passphrase");
    expect(sealed).not.toContain("re_test");
    expect(openJson(sealed, "passphrase")).toEqual({ provider: "resend", apiKey: "re_test" });
    expect(() => openJson(sealed, "other")).toThrow();
  });

  it("compares service keys without treating a different length as equal", () => {
    expect(safeEqualString("abc", "abc")).toBe(true);
    expect(safeEqualString("abc", "abd")).toBe(false);
    expect(safeEqualString("abc", "abcd")).toBe(false);
  });
});
