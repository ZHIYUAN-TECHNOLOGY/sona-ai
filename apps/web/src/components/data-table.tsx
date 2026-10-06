import { useState, type ReactNode } from "react";

import "../styles/components.css";

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Ascending comparator; giving one makes the column sortable. */
  sort?: (a: T, b: T) => number;
  align?: "left" | "center" | "right";
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Makes each row focusable; click or Enter opens it. */
  onRowOpen?: (row: T) => void;
  /** The action for a row, done in place (last column). */
  rowAction?: (row: T) => ReactNode;
  empty?: ReactNode;
};

export function DataTable<T>({ columns, rows, rowKey, onRowOpen, rowAction, empty }: Props<T>) {
  const [sorted, setSorted] = useState<{ key: string; desc: boolean } | null>(null);
  const cmp = sorted ? columns.find((c) => c.key === sorted.key)?.sort : undefined;
  const shown = cmp && sorted ? [...rows].sort(sorted.desc ? (a, b) => cmp(b, a) : cmp) : rows;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sorted?.key === c.key;
              return (
                <th key={c.key} scope="col" style={{ textAlign: c.align }} aria-sort={c.sort ? (active ? (sorted.desc ? "descending" : "ascending") : "none") : undefined}>
                  {c.sort ? (
                    <button type="button" className="table-sort" onClick={() => setSorted((s) => ({ key: c.key, desc: s?.key === c.key && !s.desc }))}>
                      {c.header}
                      <span aria-hidden="true">{active ? (sorted.desc ? " ↓" : " ↑") : " ↕"}</span>
                    </button>
                  ) : c.header}
                </th>
              );
            })}
            {rowAction ? <th scope="col"><span className="visually-hidden">Action</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td className="table-empty" colSpan={columns.length + (rowAction ? 1 : 0)}>{empty ?? "Nothing here"}</td>
            </tr>
          ) : shown.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowOpen ? "table-row-open" : undefined}
              tabIndex={onRowOpen ? 0 : undefined}
              onClick={onRowOpen ? () => onRowOpen(row) : undefined}
              onKeyDown={onRowOpen ? (e) => { if (e.key === "Enter" && e.target === e.currentTarget) onRowOpen(row); } : undefined}
            >
              {columns.map((c) => <td key={c.key} style={{ textAlign: c.align }}>{c.cell(row)}</td>)}
              {/* Acting on a row must not also open it. */}
              {rowAction ? <td className="table-action" onClick={(e) => e.stopPropagation()}>{rowAction(row)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
