import { resolveGeoContext } from "../src/common/payment-geo";

describe("trusted geo context", () => {
  it("ignores spoofed CF-IPCountry and X-Forwarded-For from an untrusted peer", () => {
    const geo = resolveGeoContext({
      directPeerIp: "203.0.113.9",
      headers: {
        "cf-ipcountry": "CN",
        "x-forwarded-for": "1.1.1.1",
        "x-geo-country": "CN",
      },
      trustedProxies: ["10.0.0.0/8", "127.0.0.1"],
      defaultCountry: "US",
    });
    expect(geo).toMatchObject({
      country: "US",
      source: "default",
      trustedProxy: false,
    });
  });

  it("trusts country headers only from a configured proxy", () => {
    const geo = resolveGeoContext({
      directPeerIp: "10.8.0.2",
      headers: { "cf-ipcountry": "CN", "x-forwarded-for": "8.8.8.8" },
      trustedProxies: ["10.0.0.0/8"],
      defaultCountry: "US",
    });
    expect(geo).toMatchObject({
      country: "CN",
      source: "trusted_header",
      trustedProxy: true,
    });
  });

  it("does not treat X-Forwarded-For as the peer even behind a trusted proxy", () => {
    const geo = resolveGeoContext({
      directPeerIp: "10.8.0.2",
      headers: { "x-forwarded-for": "1.2.3.4" },
      trustedProxies: ["10.0.0.0/8"],
      defaultCountry: null,
    });
    expect(geo.country).toBeNull();
    expect(geo.source).toBe("unknown");
    expect(geo.directPeerIp).toBe("10.8.0.2");
  });
});
