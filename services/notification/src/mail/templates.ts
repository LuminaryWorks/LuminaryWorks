const SUBJECTS: Record<string, { zh: string; en: string }> = {
  SignIn: { zh: "LuminaryWorks 登录验证码", en: "Your LuminaryWorks sign-in code" },
  Register: { zh: "验证你的 LuminaryWorks 邮箱", en: "Verify your LuminaryWorks email" },
  ForgotPassword: { zh: "重置 LuminaryWorks 密码", en: "Reset your LuminaryWorks password" },
  Generic: { zh: "LuminaryWorks 验证码", en: "Your LuminaryWorks verification code" },
  OrganizationInvitation: {
    zh: "LuminaryWorks 组织邀请",
    en: "LuminaryWorks organization invitation",
  },
  UserPermissionValidation: {
    zh: "LuminaryWorks 安全验证",
    en: "LuminaryWorks security check",
  },
  BindNewIdentifier: { zh: "绑定 LuminaryWorks 邮箱", en: "Bind your LuminaryWorks email" },
  MfaVerification: { zh: "LuminaryWorks 安全验证码", en: "Your LuminaryWorks security code" },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderAuthMail(input: {
  type: string;
  code?: string;
  link?: string;
  locale?: string;
  applicationName?: string;
}): { subject: string; text: string; html: string } {
  const zh = (input.locale ?? "").toLowerCase().startsWith("zh");
  const subject = (SUBJECTS[input.type] ?? SUBJECTS.Generic)?.[zh ? "zh" : "en"] ?? SUBJECTS.Generic.en;
  const app = input.applicationName?.trim() || "LuminaryWorks";
  const intro = zh ? `${app} 的验证信息如下。` : `Verification details for ${app}.`;
  const code = input.code?.trim();
  const link = input.link?.trim();
  const text = [intro, code, link].filter(Boolean).join("\n");
  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    code ? `<p style="font-size:24px;letter-spacing:4px">${escapeHtml(code)}</p>` : "",
    link ? `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` : "",
  ].join("");
  return { subject, text, html };
}
