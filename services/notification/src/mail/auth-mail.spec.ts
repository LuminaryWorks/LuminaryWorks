import { BadRequestException } from "@nestjs/common";
import { completeProfileWrite } from "./profile-input";
import { parseLogtoEmail } from "./logto-email";
import { renderAuthMail } from "./templates";

describe("auth mail request shaping", () => {
  it("renders a Chinese register code without putting it in the subject", () => {
    const rendered = renderAuthMail({
      type: "Register",
      code: "123456",
      locale: "zh-CN",
      applicationName: "DataLuminary",
    });
    expect(rendered.subject).toContain("邮箱");
    expect(rendered.subject).not.toContain("123456");
    expect(rendered.text).toContain("123456");
    expect(rendered.html).toContain("123456");
  });

  it("parses the Logto HTTP email payload", () => {
    expect(
      parseLogtoEmail({
        to: "user@acme.test",
        type: "Register",
        payload: {
          code: "123456",
          locale: "en",
          organization: { id: "org-1" },
          application: { name: "BlockyEdu" },
        },
      }),
    ).toMatchObject({
      to: "user@acme.test",
      type: "Register",
      code: "123456",
      organizationId: "org-1",
      applicationName: "BlockyEdu",
    });
  });

  it("rejects a public match domain on an enterprise profile", () => {
    expect(() =>
      completeProfileWrite({
        scope: "organization",
        organizationId: "org-1",
        from: "auth@gmail.com",
        provider: "smtp",
        matchDomains: ["gmail.com"],
        credentials: { host: "smtp.gmail.com" },
      }),
    ).toThrow(BadRequestException);
  });

  it("accepts a private domain SMTP profile", () => {
    const profile = completeProfileWrite({
      scope: "organization",
      organizationId: "org-1",
      from: "auth@acme.test",
      fromName: "Acme",
      provider: "smtp",
      matchDomains: ["acme.test"],
      verified: true,
      credentials: { host: "smtp.acme.test", port: 587 },
    });
    expect(profile.matchDomains).toEqual(["acme.test"]);
    expect(profile.credentials).toMatchObject({ provider: "smtp", host: "smtp.acme.test" });
  });
});
