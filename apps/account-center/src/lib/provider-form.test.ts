import { describe, expect, it } from "@rstest/core";
import { readIdentityProfile } from "./identity";
import { formatMicro } from "./micro";
import {
  toCreateProviderPayload,
  toRotateProviderPayload,
} from "./provider-form";

describe("provider form payloads", () => {
  it("creates a user-owned connection and omits a blank secret on rotate", () => {
    const created = toCreateProviderPayload(
      {
        providerType: " openai ",
        displayName: " Desk ",
        baseUrl: " https://api.openai.com/v1 ",
        model: "gpt-4.1",
        secret: " sk-new ",
        purpose: " chat ",
      },
      "user-a",
    );
    expect(created).toEqual({
      ownerKind: "user",
      ownerUid: "user-a",
      providerType: "openai",
      displayName: "Desk",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1",
      secret: "sk-new",
      enabled: true,
      isDefault: false,
      purpose: "chat",
    });
    expect(created).not.toHaveProperty("subjectId");

    const rotated = toRotateProviderPayload({
      providerType: "openai",
      displayName: "Desk",
      model: "gpt-4.1",
      secret: "  ",
      enabled: false,
    });
    expect(rotated.secret).toBeUndefined();
    expect(rotated.enabled).toBe(false);
    expect(rotated).not.toHaveProperty("ownerKind");
    expect(rotated).not.toHaveProperty("ownerUid");
  });
});

describe("identity and micro display", () => {
  it("reads sub, email, and name from the id token", () => {
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const access = `e30.${encode({ sub: "user-1" })}.sig`;
    const id = `e30.${encode({
      sub: "user-1",
      email: "a@example.com",
      name: "Ada",
    })}.sig`;
    expect(readIdentityProfile(access, id)).toEqual({
      sub: "user-1",
      email: "a@example.com",
      name: "Ada",
    });
  });

  it("formats micro credits without floats", () => {
    expect(formatMicro(5_000_000)).toBe("5");
    expect(formatMicro(1_250_000)).toBe("1.25");
    expect(formatMicro(0)).toBe("0");
    expect(formatMicro(null)).toBe("0");
  });
});
