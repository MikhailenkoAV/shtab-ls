"use client";

import { useMemo, useState } from "react";
import { downloadControlJournalExcel } from "./control-journal-export";
import { ControlKind, ControlRow, isControlAttention } from "./control-journal-rules";

const kindLabels: Record<ControlKind, string> = {
  type: "Тип",
  night: "Ночь",
  certification: "Контроль",
};

function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function displayDate(value: string): string {
  return value ? new Intl.DateTimeFormat("ru-RU").format(new Date(`${value}T12:00:00`)) : "—";
}

export function ControlJournalView({
  rows,
  onNotify,
}: {
  rows: ControlRow[];
  onNotify: (message: string) => void;
}) {
  const [kind, setKind] = useState<ControlKind>("type");
  const [query, setQuery] = useState("");
  const today = new Date();
  const after45Days = new Date(today);
  after45Days.setDate(after45Days.getDate() + 45);
  const [dateFrom, setDateFrom] = useState(localIsoDate(today));
  const [dateTo, setDateTo] = useState(localIsoDate(after45Days));
  const [exporting, setExporting] = useState(false);

  const counts = useMemo(() => ({
    type: rows.filter((row) => row.kind === "type" && isControlAttention(row)).length,
    night: rows.filter((row) => row.kind === "night" && isControlAttention(row)).length,
    certification: rows.filter((row) => row.kind === "certification" && isControlAttention(row)).length,
  }), [rows]);
  const visible = useMemo(() => rows.filter((row) =>
    row.kind === kind
    && isControlAttention(row)
    && `${row.personName} ${row.subject} ${row.aircraftType}`.toLocaleLowerCase("ru-RU")
      .includes(query.trim().toLocaleLowerCase("ru-RU"))), [kind, query, rows]);

  async function exportJournal() {
    setExporting(true);
    try {
      await downloadControlJournalExcel(rows, dateFrom, dateTo);
      onNotify("Контрольный журнал выгружен в Excel");
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : "Не удалось сформировать выгрузку");
    } finally {
      setExporting(false);
    }
  }

  return <section className="panel control-journal-panel">
    <div className="panel-heading control-journal-heading"><div><p className="eyebrow">Контроль сроков</p><h2>Контрольный журнал</h2></div><div className="control-export">
      <label><span>Период с</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
      <label><span>по</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      <button className="secondary-button" disabled={exporting} onClick={exportJournal}>{exporting ? "Формирую…" : "Выгрузить Excel"}</button>
    </div></div>
    <div className="control-journal-tabs" role="tablist">{(["type", "night", "certification"] as ControlKind[]).map((item) =>
      <button key={item} className={kind === item ? "active" : ""} onClick={() => setKind(item)} role="tab" aria-selected={kind === item}><span>{kindLabels[item]}</span><i>{counts[item]}</i></button>)}</div>
    <div className="records-toolbar control-journal-toolbar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по сотруднику, типу или документу…" />
      <span className="control-attention-note">Показаны только записи, требующие внимания</span>
    </div>
    <div className="control-journal-note">{kind === "type"
      ? "Срок 90 дней рассчитывается от последнего полёта сотрудника на каждом допущенном типе ВС."
      : kind === "night"
        ? "Показываются только типы ВС, для которых в карточке сотрудника установлен допуск к полётам ночью."
        : "Сроки документов берутся из личных дел и обновляются после импорта из Авиабит."}</div>
    {!visible.length ? <div className="panel-empty tall">В этом разделе нет записей, требующих внимания.</div> : <div className="table-scroll"><table className="control-journal-table"><thead><tr><th>Сотрудник</th><th>{kind === "certification" ? "Документ" : "Тип ВС"}</th><th>{kind === "certification" ? "Начало" : "Последний полёт"}</th><th>Срок</th><th>Осталось</th><th>Состояние</th></tr></thead><tbody>{visible.map((row) =>
      <tr key={row.id}><td><strong>{row.personName}</strong></td><td><strong>{kind === "certification" ? row.subject : row.aircraftType}</strong>{kind === "certification" && row.aircraftType && <small>{row.aircraftType}</small>}</td><td>{displayDate(row.referenceDate)}</td><td>{displayDate(row.dueDate)}</td><td>{row.daysLeft === null ? "—" : row.daysLeft < 0 ? `−${Math.abs(row.daysLeft)} дн.` : `${row.daysLeft} дн.`}</td><td><span className={`expiry-pill ${row.status}`}>{row.statusLabel}</span></td></tr>)}</tbody></table></div>}
  </section>;
}
