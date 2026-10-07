import { Link, type LinkProps } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { Avatar } from "./avatar";
import { Icon } from "./icon";
import "../styles/components.css";
import "../styles/data.css";

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
  /** The `rowKey` of the row shown as selected. */
  selectedKey?: string;
  /** Filters or search, above the header. */
  toolbar?: ReactNode;
  /** Left of the footer, e.g. "Showing 1-8 of 42". */
  count?: ReactNode;
  /** Right of the footer, e.g. a pager. */
  footer?: ReactNode;
  /** Skeleton rows instead of data; a number sets how many (default 5). */
  loading?: boolean | number;
};

/** A person: avatar, name, and a muted second line. */
export function PersonCell({ name, detail, size = "md" }: { name: string; detail?: ReactNode; size?: "sm" | "md" | "lg" }) {
  return (
    <span className="cell-person">
      <Avatar name={name} size={size} />
      <span className="cell-person-text">
        <span className="cell-person-name" title={name} dir="auto">{name}</span>
        {detail ? <span className="cell-muted" title={typeof detail === "string" ? detail : undefined}>{detail}</span> : null}
      </span>
    </span>
  );
}

/** Long text in a cell: at most two lines, then an ellipsis; full text in `title`. */
export function TextCell({ children }: { children: ReactNode }) {
  return <span className="cell-clamp" title={typeof children === "string" ? children : undefined}>{children}</span>;
}

/** The `toolbar` layout: `children` (tabs, filters) left, `end` (search, icon buttons) right; wraps under 900px. */
export function TableToolbar({ children, end }: { children?: ReactNode; end?: ReactNode }) {
  return (
    <div className="table-toolbar-row">
      <div className="table-toolbar-start">{children}</div>
      {end ? <div className="table-toolbar-end">{end}</div> : null}
    </div>
  );
}

/** A reading with its unit in muted text. */
export function ValueCell({ value, unit }: { value: ReactNode; unit?: ReactNode }) {
  return <span className="cell-value">{value}{unit ? <span className="cell-muted"> {unit}</span> : null}</span>;
}

/** The row's action: text and an arrow; an ink pill on the selected row. */
export function RowAction({ children, onClick, to }: { children: ReactNode; onClick?: () => void; to?: LinkProps["to"] }) {
  const inner = <>{children}<Icon name="arrow-right" size={16} /></>;
  return to
    ? <Link className="row-action" to={to} onClick={onClick}>{inner}</Link>
    : <button type="button" className="row-action" onClick={onClick}>{inner}</button>;
}

export function DataTable<T>({ columns, rows, rowKey, onRowOpen, rowAction, empty, selectedKey, toolbar, count, footer, loading }: Props<T>) {
  const [sorted, setSorted] = useState<{ key: string; desc: boolean } | null>(null);
  const cmp = sorted ? columns.find((c) => c.key === sorted.key)?.sort : undefined;
  const shown = cmp && sorted ? [...rows].sort(sorted.desc ? (a, b) => cmp(b, a) : cmp) : rows;

  return (
    <div className="table-wrap">
      {toolbar ? <div className="table-toolbar">{toolbar}</div> : null}
      <div className="table-scroll">
      <table className="table" aria-busy={loading ? true : undefined}>
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
            {rowAction ? <th scope="col" className="table-action"><span className="visually-hidden">Action</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: loading === true ? 5 : loading }, (_, r) => (
              <tr key={r} aria-hidden="true">
                {Array.from({ length: columns.length + (rowAction ? 1 : 0) }, (_, c) => <td key={c}><span className="table-skel" /></td>)}
              </tr>
            ))
          ) : shown.length === 0 ? (
            <tr>
              <td className="table-empty" colSpan={columns.length + (rowAction ? 1 : 0)}>{empty ?? "Nothing here"}</td>
            </tr>
          ) : shown.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowOpen ? "table-row-open" : undefined}
              data-selected={rowKey(row) === selectedKey ? "" : undefined}
              aria-current={rowKey(row) === selectedKey ? "true" : undefined}
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
      {loading ? <p className="visually-hidden" role="status">Loading</p> : null}
      {count || footer ? (
        <div className="table-foot">
          <span className="table-count">{count}</span>
          {footer}
        </div>
      ) : null}
    </div>
  );
}
