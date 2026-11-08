import {
  ApiOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  CreditCardOutlined,
  DashboardOutlined,
  FundOutlined,
  GlobalOutlined,
  LogoutOutlined,
  ProfileOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  UnorderedListOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { AppShell, type ShellNavGroup } from "@luminaryworks/ui";
import { Button, Dropdown } from "antd";
import { type ReactNode, useMemo } from "react";
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
import { ReasonConfirmHost } from "./components/ReasonConfirmDialog";
import type { ConsoleLocale } from "./i18n";
import type { AiClient } from "./lib/ai-client";
import type { createApiClient } from "./lib/api-client";
import { isPlatformAdmin, readJwtScopes } from "./lib/jwt-scopes";
import { LOCALE_FULL_KEY, LOCALE_SHORT_KEY } from "./lib/locale-labels";
import { isProviderId } from "./lib/payment-providers";
import type { RuntimeConfig } from "./lib/runtime-config";
import {
  AiConnectionsPage,
  AiOverviewPage,
  AiRateCardsPage,
  AiUsagePage,
  AiWalletsPage,
} from "./pages/ai/AiPages";
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
import { PartnersPage } from "./pages/PartnersPage";
import { PREFERRED_LOCALES } from "./preferred-locale";
import "antd/dist/reset.css";

type Api = ReturnType<typeof createApiClient>;

export function ConsoleShell({
  api,
  ai,
  runtime,
  accessToken,
  locale,
  onLocaleChange,
  onSignOut,
}: {
  api: Api;
  ai: AiClient;
  runtime: RuntimeConfig;
  accessToken: string;
  locale: ConsoleLocale;
  onLocaleChange: (next: ConsoleLocale) => void;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const paymentsOff = runtime.paymentsMode === "disabled";
  const tenant = runtime.consoleRole === "tenant";
  const scopes = readJwtScopes(accessToken);
  const platformAdmin = isPlatformAdmin(scopes);
  const aiOperator = !tenant && (platformAdmin || scopes.includes("ai:admin"));
  const catalogAdmin =
    platformAdmin ||
    scopes.some((scope) => scope.startsWith("entitlement:catalog:"));

  const nav = useMemo(
    (): ShellNavGroup[] => [
      {
        key: "nav.groupCommerce",
        labelKey: "nav.groupCommerce",
        items: [
          {
            key: "/",
            to: "/",
            labelKey: "nav.overview",
            icon: <DashboardOutlined />,
          },
          {
            key: "/catalog",
            to: "/catalog",
            labelKey: "nav.catalog",
            icon: <UnorderedListOutlined />,
            visible: !tenant && catalogAdmin,
          },
          {
            key: "/partners",
            to: "/partners",
            labelKey: "nav.partners",
            icon: <AppstoreOutlined />,
            visible: !tenant && platformAdmin,
          },
          {
            key: "/commerce/channels",
            to: "/commerce/channels",
            labelKey: "nav.providers",
            icon: <CreditCardOutlined />,
            visible: !paymentsOff,
          },
          {
            key: "/orders",
            to: "/orders",
            labelKey: "nav.orders",
            icon: <ProfileOutlined />,
            visible: !paymentsOff,
          },
        ],
      },
      {
        key: "nav.groupTrust",
        labelKey: "nav.groupTrust",
        visible: !tenant,
        items: [
          {
            key: "/legal",
            to: "/legal",
            labelKey: "nav.legal",
            icon: <SafetyCertificateOutlined />,
          },
        ],
      },
      {
        key: "nav.groupAi",
        labelKey: "nav.groupAi",
        visible: aiOperator,
        items: [
          {
            key: "/ai",
            to: "/ai",
            labelKey: "nav.aiOverview",
            icon: <RobotOutlined />,
          },
          {
            key: "/ai/connections",
            to: "/ai/connections",
            labelKey: "nav.aiConnections",
            icon: <ApiOutlined />,
          },
          {
            key: "/ai/rate-cards",
            to: "/ai/rate-cards",
            labelKey: "nav.aiRateCards",
            icon: <UnorderedListOutlined />,
          },
          {
            key: "/ai/wallets",
            to: "/ai/wallets",
            labelKey: "nav.aiWallets",
            icon: <WalletOutlined />,
          },
          {
            key: "/ai/usage",
            to: "/ai/usage",
            labelKey: "nav.aiUsage",
            icon: <FundOutlined />,
          },
        ],
      },
      {
        key: "nav.groupPlatform",
        labelKey: "nav.groupPlatform",
        visible: !tenant,
        items: [
          {
            key: "/cleanup",
            to: "/cleanup",
            labelKey: "nav.cleanup",
            icon: <ReloadOutlined />,
          },
          {
            key: "/capacity",
            to: "/capacity",
            labelKey: "nav.capacity",
            icon: <BarChartOutlined />,
          },
        ],
      },
    ],
    [aiOperator, catalogAdmin, paymentsOff, platformAdmin, tenant],
  );

  return (
    <AppShell
      logoSrc={logoUrl}
      title={t("app.title")}
      nav={nav}
      pathname={location.pathname}
      onNavigate={(to) => navigate(to)}
      siderStorageKey="lw-cc-sider"
      skipLabel={t("nav.skip")}
      collapseLabel={t("nav.collapse")}
      expandLabel={t("nav.expand")}
      t={(key) => t(key)}
      localeMenu={
        <Dropdown
          menu={{
            selectedKeys: [locale],
            items: PREFERRED_LOCALES.map((code) => ({
              key: code,
              label: t(LOCALE_FULL_KEY[code]),
            })),
            onClick: ({ key }) => onLocaleChange(key as ConsoleLocale),
          }}
        >
          <Button type="text" icon={<GlobalOutlined />}>
            {t(LOCALE_SHORT_KEY[locale])}
          </Button>
        </Dropdown>
      }
      userMenu={
        <Button type="text" icon={<LogoutOutlined />} onClick={onSignOut}>
          {t("nav.logout")}
        </Button>
      }
      confirm={{
        title: t("confirm.title"),
        cancelLabel: t("common.cancel"),
        confirmLabel: t("common.confirm"),
      }}
    >
      <ReasonConfirmHost
        title={t("confirm.title")}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("common.confirm")}
        reasonLabel={t("confirm.reasonLabel")}
        reasonPlaceholder={t("confirm.reasonPlaceholder")}
      />
      <Routes>
        <Route
          path="/"
          element={<OverviewPage api={api} runtime={runtime} />}
        />
        <Route
          path="/catalog"
          element={<CatalogPage api={api} platformAdmin={platformAdmin} />}
        />
        <Route
          path="/partners"
          element={
            !tenant && platformAdmin ? (
              <PartnersPage api={api} />
            ) : (
              <Navigate to="/" replace />
            )
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
          element={<ChannelSetupRoute api={api} role={runtime.consoleRole} />}
        />
        <Route
          path="/commerce/channels/:id"
          element={<ChannelRoute api={api} role={runtime.consoleRole} />}
        />
        <Route path="/orders" element={<OrdersPage api={api} />} />
        <Route path="/cleanup" element={<CleanupPage api={api} />} />
        <Route
          path="/legal"
          element={<LegalPage api={api} legalDocsUrl={runtime.legalDocsUrl} />}
        />
        <Route
          path="/capacity"
          element={<CapacityPage api={api} runtime={runtime} />}
        />
        <Route
          path="/ai"
          element={
            <AiGate allow={aiOperator}>
              <AiOverviewPage ai={ai} />
            </AiGate>
          }
        />
        <Route
          path="/ai/connections"
          element={
            <AiGate allow={aiOperator}>
              <AiConnectionsPage ai={ai} />
            </AiGate>
          }
        />
        <Route
          path="/ai/rate-cards"
          element={
            <AiGate allow={aiOperator}>
              <AiRateCardsPage ai={ai} />
            </AiGate>
          }
        />
        <Route
          path="/ai/wallets"
          element={
            <AiGate allow={aiOperator}>
              <AiWalletsPage ai={ai} />
            </AiGate>
          }
        />
        <Route
          path="/ai/usage"
          element={
            <AiGate allow={aiOperator}>
              <AiUsagePage ai={ai} />
            </AiGate>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

function AiGate({ allow, children }: { allow: boolean; children: ReactNode }) {
  if (!allow) return <Navigate to="/" replace />;
  return children;
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
