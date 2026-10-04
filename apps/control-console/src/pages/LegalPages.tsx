export function LegalTermsPage({ product }: { product: string }) {
  return (
    <article style={{ maxWidth: 720, margin: "32px auto", padding: "0 20px 64px", lineHeight: 1.65 }}>
      <p>
        <a href="/">← 登录</a>
      </p>
      <h1>{product} 用户协议</h1>
      <p>
        本控制台供客户管理员维护收银台、目录与订单。须同时同意 LuminaryWorks 通用服务条款。按「现状」提供。
      </p>
      <p>联系：legal@luminaryworks.dev</p>
    </article>
  );
}

export function LegalPrivacyPage({ product }: { product: string }) {
  return (
    <article style={{ maxWidth: 720, margin: "32px auto", padding: "0 20px 64px", lineHeight: 1.65 }}>
      <p>
        <a href="/">← 登录</a>
      </p>
      <h1>{product} 隐私政策</h1>
      <p>
        账号由 LuminaryWorks 统一身份处理。本控制台调用 Entitlement 管理 API。
      </p>
      <p>联系：legal@luminaryworks.dev</p>
    </article>
  );
}
