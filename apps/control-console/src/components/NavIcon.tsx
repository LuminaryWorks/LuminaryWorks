export type NavIconName =
  | "overview"
  | "catalog"
  | "providers"
  | "orders"
  | "legal"
  | "cleanup"
  | "capacity";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 20 20"
      width="18"
      height="18"
      aria-hidden="true"
    >
      {name === "overview" ? (
        <>
          <rect x="3" y="3" width="6" height="6" rx="1.2" {...stroke} />
          <rect x="11" y="3" width="6" height="6" rx="1.2" {...stroke} />
          <rect x="3" y="11" width="6" height="6" rx="1.2" {...stroke} />
          <rect x="11" y="11" width="6" height="6" rx="1.2" {...stroke} />
        </>
      ) : null}
      {name === "catalog" ? (
        <path d="M4 4.5h12M4 10h12M4 15.5h8" {...stroke} />
      ) : null}
      {name === "providers" ? (
        <>
          <rect x="2.5" y="4.5" width="15" height="11" rx="1.6" {...stroke} />
          <path d="M2.5 8.5h15" {...stroke} />
        </>
      ) : null}
      {name === "orders" ? (
        <>
          <path d="M6 3.5h8l1.5 2.5v10.5H4.5V6z" {...stroke} />
          <path d="M7.5 10.5h5M7.5 13.5h5" {...stroke} />
        </>
      ) : null}
      {name === "legal" ? (
        <path
          d="M10 2.8l6 2.2v5.2c0 3.2-2.4 5.4-6 6.8-3.6-1.4-6-3.6-6-6.8V5z"
          {...stroke}
        />
      ) : null}
      {name === "cleanup" ? (
        <path d="M16 7.5A6 6 0 1 1 13.2 4M16 3.5v4h-4" {...stroke} />
      ) : null}
      {name === "capacity" ? (
        <path d="M4 15.5V10M10 15.5V5M16 15.5V8" {...stroke} />
      ) : null}
    </svg>
  );
}

export function LogoutIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path d="M8 4.5H5.5v11H8" {...stroke} />
      <path d="M9.5 10h7M13.5 7l3 3-3 3" {...stroke} />
    </svg>
  );
}

export function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      {collapsed ? (
        <path d="M7 4.5l6 5.5-6 5.5" {...stroke} />
      ) : (
        <path d="M13 4.5l-6 5.5 6 5.5" {...stroke} />
      )}
    </svg>
  );
}
