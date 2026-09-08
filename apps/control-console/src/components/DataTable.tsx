import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function DataTable({
  columns,
  rows,
  rowKey,
}: {
  columns: {
    key: string;
    header: string;
    render?: (row: Record<string, unknown>) => ReactNode;
  }[];
  rows: Record<string, unknown>[];
  rowKey: string;
}) {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return <p className="muted">{t("common.empty")}</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row[rowKey])}>
              {columns.map((col) => (
                <td key={col.key}>
                  {col.render ? col.render(row) : String(row[col.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
