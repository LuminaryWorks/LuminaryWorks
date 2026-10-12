import {
  BarChartOutlined,
  CreditCardOutlined,
  DashboardOutlined,
  GlobalOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ProfileOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { Button, ConfigProvider, Dropdown, Layout, Menu } from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import logoUrl from "../../../assets/logo.svg?url";
import { luminaryAntTheme } from "../../../shared/brand/ant-theme";
import { ConfirmDialogHost } from "./components/ConfirmDialog";
import type { ConsoleLocale } from "./i18n";
import type { createApiClient } from "./lib/api-client";
import { isPlatformAdmin, readJwtScopes } from "./lib/jwt-scopes";
import { isProviderId } from "./lib/payment-providers";
import type { RuntimeConfig } from "./lib/runtime-config";
import {
  ChannelSetupPage,
  ChannelsPage,
  isSetupProvider,
} from "./pages/channels/ChannelPages";
import {
  CapacityPage,
  CleanupPage,
  LegalPage,
  OrdersPage,
} from "./pages/OpsPages";
import { CatalogPage, OverviewPage } from "./pages/OverviewCatalogProviders";
import { PREFERRED_LOCALES } from "./preferred-locale";
import "antd/dist/reset.css";

const { Header, Sider, Content } = Layout;

const SHORT_KEY: Record<ConsoleLocale, string> = {
  en: "lang.short.en",
  "zh-CN": "lang.short.zhCN",
  "zh-TW": "lang.short.zhTW",
  ja: "lang.short.ja",
  ko: "lang.short.ko",
  pt: "lang.short.pt",
  nl: "lang.short.nl",
  it: "lang.short.it",
  es: "lang.short.es",
  fr: "lang.short.fr",
};

const FULL_KEY: Record<ConsoleLocale, string> = {
  en: "lang.full.en",
  "zh-CN": "lang.full.zhCN",
  "zh-TW": "lang.full.zhTW",
  ja: "lang.full.ja",
  ko: "lang.full.ko",
  pt: "lang.full.pt",
  nl: "lang.full.nl",
  it: "lang.full.it",
  es: "lang.full.es",
  fr: "lang.full.fr",
};

const ICONS = {
  overview: <DashboardOutlined />,
  catalog: <UnorderedListOutlined />,
  providers: <CreditCardOutlined />,
  orders: <ProfileOutlined />,
  legal: <SafetyCertificateOutlined />,
  cleanup: <ReloadOutlined />,
  capacity: <BarChartOutlined />,
} as const;

type Api = ReturnType<typeof createApiClient>;
type NavIconName = keyof typeof ICONS;
type NavItem = { to: string; key: string; icon: NavIconName };

export function ConsoleShell({
  api,
  runtime,
  accessToken,
  locale,
  onLocaleChange,
  onSignOut,
}: {
  api: Api;
  runtime: RuntimeConfig;
  accessToken: string;
  locale: ConsoleLocale;
  onLocaleChange: (next: ConsoleLocale) => void;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("lw-cc-sider") === "1",
  );

  const paymentsOff = runtime.paymentsMode === "disabled";
  const tenant = runtime.consoleRole === "tenant";
  const scopes = readJwtScopes(accessToken);
  const platformAdmin = isPlatformAdmin(scopes);
  const catalogAdmin =
    platformAdmin ||
    scopes.some((scope) => scope.startsWith("entitlement:catalog:"));

  const groups = useMemo(
    (): { key: string; items: NavItem[] }[] => [
      {
        key: "nav.groupCommerce",
        items: [
          { to: "/", key: "nav.overview", icon: "overview" as const },
          ...(tenant || !catalogAdmin
            ? []
            : [
                {
                  to: "/catalog",
                  key: "nav.catalog",
                  icon: "catalog" as const,
                },
              ]),
          ...(paymentsOff
            ? []
            : [
                {
                  to: "/commerce/channels",
                  key: "nav.providers",
                  icon: "providers" as const,
                },
                { to: "/orders", key: "nav.orders", icon: "orders" as const },
              ]),
        ],
      },
      ...(tenant
        ? []
        : [
            {
              key: "nav.groupTrust",
              items: [
                { to: "/legal", key: "nav.legal", icon: "legal" as const },
              ],
            },
            {
              key: "nav.groupPlatform",
              items: [
                {
                  to: "/cleanup",
                  key: "nav.cleanup",
                  icon: "cleanup" as const,
                },
                {
                  to: "/capacity",
                  key: "nav.capacity",
                  icon: "capacity" as const,
                },
              ],
            },
          ]),
    ],
    [catalogAdmin, paymentsOff, tenant],
  );

  const selected = useMemo(() => {
    const items = groups.flatMap((group) => group.items);
    const match = items.find((item) =>
      item.to === "/"
        ? location.pathname === "/"
        : location.pathname === item.to ||
          location.pathname.startsWith(`${item.to}/`),
    );
    return match?.to ?? "/";
  }, [groups, location.pathname]);

  const menuItems: MenuProps["items"] = groups.map((group) => ({
    type: "group",
    key: group.key,
    label: t(group.key),
    children: group.items.map((item) => ({
      key: item.to,
      icon: ICONS[item.icon],
      label: t(item.key),
    })),
  }));

  return (
    <ConfigProvider theme={luminaryAntTheme}>
      <Layout className="console-layout">
        <a className="skip" href="#main">
          {t("nav.skip")}
        </a>
        <Sider
          className="console-sider"
          collapsed={collapsed}
          collapsible
          trigger={null}
          width={248}
          theme="dark"
        >
          <div className="console-brand">
            <img
              className="console-mark"
              src={logoUrl}
              alt={collapsed ? t("app.title") : ""}
            />
            {collapsed ? null : (
              <span className="console-brand-name">{t("app.title")}</span>
            )}
          </div>
          <div className="console-menu-scroll">
            <Menu
              theme="dark"
              mode="inline"
              inlineCollapsed={collapsed}
              style={{ width: "100%" }}
              selectedKeys={[selected]}
              items={menuItems}
              onClick={({ key }) => navigate(key)}
            />
          </div>
          <button
            type="button"
            className="console-sider-toggle"
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
            onClick={() => {
              const next = !collapsed;
              setCollapsed(next);
              localStorage.setItem("lw-cc-sider", next ? "1" : "0");
            }}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            {collapsed ? null : <span>{t("nav.collapse")}</span>}
          </button>
        </Sider>
        <Layout className="console-main">
          <Header className="console-header">
            <div id="page-header-slot" className="page-header-slot" />
            <div className="console-tools">
              <Dropdown
                menu={{
                  selectedKeys: [locale],
                  items: PREFERRED_LOCALES.map((code) => ({
                    key: code,
                    label: t(FULL_KEY[code]),
                  })),
                  onClick: ({ key }) => onLocaleChange(key as ConsoleLocale),
                }}
              >
                <Button type="text" icon={<GlobalOutlined />}>
                  {t(SHORT_KEY[locale])}
                </Button>
              </Dropdown>
              <Button type="text" icon={<LogoutOutlined />} onClick={onSignOut}>
                {t("nav.logout")}
              </Button>
            </div>
          </Header>
          <Content id="main" className="console-content">
            <Routes>
              <Route
                path="/"
                element={<OverviewPage api={api} runtime={runtime} />}
              />
              <Route
                path="/catalog"
                element={
                  <CatalogPage api={api} platformAdmin={platformAdmin} />
                }
              />
              <Route
                path="/providers"
                element={<Navigate to="/commerce/channels" replace />}
              />
              <Route
                path="/commerce/channels"
                element={<ChannelsPage api={api} role={runtime.consoleRole} />}
              />
              <Route
                path="/commerce/channels/new"
                element={<Navigate to="/commerce/channels" replace />}
              />
              <Route
                path="/commerce/channels/setup/:providerId"
                element={
                  <ChannelSetupRoute api={api} role={runtime.consoleRole} />
                }
              />
              <Route
                path="/commerce/channels/:id"
                element={<ChannelRoute api={api} role={runtime.consoleRole} />}
              />
              <Route path="/orders" element={<OrdersPage api={api} />} />
              <Route path="/cleanup" element={<CleanupPage api={api} />} />
              <Route
                path="/legal"
                element={
                  <LegalPage api={api} legalDocsUrl={runtime.legalDocsUrl} />
                }
              />
              <Route
                path="/capacity"
                element={<CapacityPage api={api} runtime={runtime} />}
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Content>
        </Layout>
      </Layout>
      <ConfirmDialogHost />
    </ConfigProvider>
  );
}

function ChannelSetupRoute({
  api,
  role,
}: {
  api: Api;
  role: RuntimeConfig["consoleRole"];
}) {
  const { providerId } = useParams();
  if (!isSetupProvider(providerId)) {
    return <Navigate to="/commerce/channels" replace />;
  }
  return <ChannelSetupPage api={api} role={role} providerId={providerId} />;
}

function ChannelRoute({
  api,
  role,
}: {
  api: Api;
  role: RuntimeConfig["consoleRole"];
}) {
  const { id } = useParams();
  if (!id) return <Navigate to="/commerce/channels" replace />;
  if (isProviderId(id)) {
    return <Navigate to={`/commerce/channels/setup/${id}`} replace />;
  }
  return <ChannelSetupPage api={api} role={role} configId={id} />;
}
