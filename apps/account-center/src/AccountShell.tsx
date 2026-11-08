import {
  AppstoreOutlined,
  CreditCardOutlined,
  KeyOutlined,
  LogoutOutlined,
  UserOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { AppShell, type ShellNavGroup } from "@luminaryworks/ui";
import { Button, Dropdown } from "antd";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import logoUrl from "../../../assets/logo.svg?url";
import type { AccountLocale } from "./i18n";
import type { createApiClient } from "./lib/api-client";
import type { IdentityProfile } from "./lib/identity";
import { LOCALE_FULL_KEY, LOCALE_SHORT_KEY } from "./lib/locale-labels";
import type { RuntimeConfig } from "./lib/runtime-config";
import { AppsPage } from "./pages/AppsPage";
import { BillingPage } from "./pages/BillingPage";
import { KeysPage } from "./pages/KeysPage";
import { ProfilePage } from "./pages/ProfilePage";
import { WalletPage } from "./pages/WalletPage";
import { PREFERRED_LOCALES } from "./preferred-locale";
import "antd/dist/reset.css";

type Api = ReturnType<typeof createApiClient>;

export function AccountShell({
  ai,
  entitlement,
  runtime,
  profile,
  locale,
  onLocaleChange,
  onSignOut,
}: {
  ai: Api;
  entitlement: Api;
  runtime: RuntimeConfig;
  profile: IdentityProfile;
  locale: AccountLocale;
  onLocaleChange: (next: AccountLocale) => void;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const nav = useMemo(
    (): ShellNavGroup[] => [
      {
        key: "nav.groupAccount",
        labelKey: "nav.groupAccount",
        items: [
          {
            key: "/",
            to: "/",
            labelKey: "nav.profile",
            icon: <UserOutlined />,
          },
          {
            key: "/billing",
            to: "/billing",
            labelKey: "nav.billing",
            icon: <CreditCardOutlined />,
          },
          {
            key: "/apps",
            to: "/apps",
            labelKey: "nav.apps",
            icon: <AppstoreOutlined />,
          },
        ],
      },
      {
        key: "nav.groupAi",
        labelKey: "nav.groupAi",
        items: [
          {
            key: "/wallet",
            to: "/wallet",
            labelKey: "nav.wallet",
            icon: <WalletOutlined />,
          },
          {
            key: "/keys",
            to: "/keys",
            labelKey: "nav.keys",
            icon: <KeyOutlined />,
          },
        ],
      },
    ],
    [],
  );

  return (
    <AppShell
      logoSrc={logoUrl}
      title={t("app.title")}
      nav={nav}
      pathname={location.pathname}
      onNavigate={(to) => navigate(to)}
      siderStorageKey="lw-ac-sider"
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
            onClick: ({ key }) => onLocaleChange(key as AccountLocale),
          }}
        >
          <Button type="text">{t(LOCALE_SHORT_KEY[locale])}</Button>
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
      <Routes>
        <Route
          path="/"
          element={<ProfilePage profile={profile} runtime={runtime} />}
        />
        <Route
          path="/billing"
          element={
            <BillingPage entitlement={entitlement} apps={runtime.apps} />
          }
        />
        <Route path="/wallet" element={<WalletPage ai={ai} />} />
        <Route
          path="/keys"
          element={<KeysPage ai={ai} ownerUid={profile.sub} />}
        />
        <Route path="/apps" element={<AppsPage apps={runtime.apps} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
