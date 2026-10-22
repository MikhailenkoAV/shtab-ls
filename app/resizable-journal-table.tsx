"use client";

import { CSSProperties, PointerEvent, ReactNode, useRef, useState } from "react";
import { columnWidth, JOURNAL_COLUMNS, JOURNAL_COLUMN_WIDTHS_KEY, journalColumnWidths, JournalColumnId, JournalColumnWidths, MAX_JOURNAL_COLUMN_WIDTH } from "./journal-column-rules";

function initialWidths() {
  try {
    return typeof window === "undefined" ? { widths: journalColumnWidths(), error: "" } : { widths: journalColumnWidths(JSON.parse(localStorage.getItem(JOURNAL_COLUMN_WIDTHS_KEY) ?? "null")), error: "" };
  } catch {
    return { widths: journalColumnWidths(), error: "Не удалось прочитать размеры. Используется стандартная ширина." };
  }
}

export function ResizableJournalTable({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState(initialWidths);
  const [hidden, setHidden] = useState<JournalColumnId[]>(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem("shtab-ls.journal-hidden-columns.v1") ?? "[]"); return Array.isArray(saved) ? JOURNAL_COLUMNS.filter((column) => !["date", "person", "actions"].includes(column.id) && saved.includes(column.id)).map((column) => column.id) : []; } catch { return []; }
  });
  function updateHidden(next: JournalColumnId[]) {
    setHidden(next);
    try { localStorage.setItem("shtab-ls.journal-hidden-columns.v1", JSON.stringify(next)); }
    catch { setLayout((current) => ({ ...current, error: "Не удалось запомнить набор столбцов. Он действует до закрытия страницы." })); }
  }
  const widthsRef = useRef(layout.widths);
  const dragRef = useRef<{ id: JournalColumnId; pointerId: number; x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState<JournalColumnId | null>(null);
  function updateWidths(widths: JournalColumnWidths, persist = false) {
    widthsRef.current = widths;
    let error = layout.error;
    if (persist) {
      try { localStorage.setItem(JOURNAL_COLUMN_WIDTHS_KEY, JSON.stringify(widths)); error = ""; }
      catch { error = "Не удалось запомнить ширину. Размеры действуют до закрытия этой страницы."; }
    }
    setLayout({ widths, error });
  }
  function resize(id: JournalColumnId, value: number, persist = false) {
    updateWidths({ ...widthsRef.current, [id]: columnWidth(id, value) }, persist);
  }
  function finishDrag(event: PointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null; setDragging(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    updateWidths(widthsRef.current, true);
  }
  const widths = layout.widths;
  const style = { "--journal-table-width": `${JOURNAL_COLUMNS.filter((column) => !hidden.includes(column.id)).reduce((sum, column) => sum + widths[column.id], 0)}px`, "--journal-actions-width": `${widths.actions}px` } as CSSProperties;
  return <>
    <style>{`@media (min-width: 761px) { ${hidden.map((id) => {
      const column = JOURNAL_COLUMNS.find((item) => item.id === id)!;
      const label = id === "work" ? "Рабочее время" : column.label;
      return `.resizable-journal-table th[data-column="${id}"], .resizable-journal-table col[data-column="${id}"], .resizable-journal-table td[data-label="${label}"] { display:none; }`;
    }).join(" ")} }`}</style>
    <div className="journal-column-tools"><details className="journal-column-picker"><summary>Столбцы · {JOURNAL_COLUMNS.length - hidden.length} из {JOURNAL_COLUMNS.length}</summary><div>{JOURNAL_COLUMNS.filter((column) => !["date", "person", "actions"].includes(column.id)).map((column) => <label key={column.id}><input type="checkbox" checked={!hidden.includes(column.id)} onChange={() => updateHidden(hidden.includes(column.id) ? hidden.filter((id) => id !== column.id) : [...hidden, column.id])} />{column.label}</label>)}<button className="row-action" onClick={() => updateHidden([])}>Показать все</button></div></details><span>Тяните границы заголовков для изменения ширины. Двойной щелчок — стандартная ширина столбца.</span><button type="button" className="row-action" onClick={() => updateWidths(journalColumnWidths(), true)}>Сбросить ширину</button>{layout.error && <small role="status">{layout.error}</small>}</div>
    <div className="table-scroll journal-table-scroll"><table style={style} className={`journal-table resizable-journal-table${dragging ? " journal-resizing" : ""}${widths.note + widths.actions > 600 ? " journal-wide-tail" : ""}`}>
      <colgroup>{JOURNAL_COLUMNS.map((column) => <col key={column.id} data-column={column.id} style={{ width: widths[column.id] }} />)}</colgroup>
      <thead><tr>{JOURNAL_COLUMNS.map((column) => <th key={column.id} data-column={column.id} scope="col" className={"className" in column ? column.className : undefined}><span>{column.label}</span><span
        className={`journal-column-resizer${dragging === column.id ? " active" : ""}`}
        role="separator" tabIndex={0} aria-orientation="vertical" aria-label={`Ширина столбца «${column.label}»`}
        aria-valuemin={column.min} aria-valuemax={MAX_JOURNAL_COLUMN_WIDTH} aria-valuenow={widths[column.id]} aria-valuetext={`${widths[column.id]} пикселей`}
        title="Тяните границу. Двойной щелчок — сброс столбца. Стрелки ← и → — изменение с клавиатуры."
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { id: column.id, pointerId: event.pointerId, x: event.clientX, width: widthsRef.current[column.id] };
          setDragging(column.id);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (drag?.pointerId === event.pointerId) resize(drag.id, drag.width + event.clientX - drag.x);
        }}
        onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
        onDoubleClick={() => resize(column.id, column.width, true)}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const step = event.shiftKey ? 50 : 10;
          const next = event.key === "Home" ? column.min : event.key === "End" ? MAX_JOURNAL_COLUMN_WIDTH : widthsRef.current[column.id] + (event.key === "ArrowRight" ? step : -step);
          resize(column.id, next, true);
        }}
      /></th>)}</tr></thead>{children}
    </table></div>
  </>;
}
