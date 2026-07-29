"use client";

import { useMemo, useState } from "react";
import {
  buildFlightBook,
  FlightBookBaseline,
  FlightBookBaselineRow,
  FlightBookShiftRef,
} from "./flight-book-rules";
import { FlightBookImportPreview, parseFlightBookImport } from "./flight-book-import-rules";

type FlightBookPerson = {
  id: string;
  name: string;
  aircraftTypes: string[];
};

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const localIsoDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const displayDate = (value: string) => value
  ? new Intl.DateTimeFormat("ru-RU").format(new Date(`${value}T12:00:00`))
  : "—";
const displayMinutes = (minutes: number) =>
  `${Math.floor(Math.max(0, minutes) / 60)}:${String(Math.max(0, minutes) % 60).padStart(2, "0")}`;

export function FlightBookView({
  person,
  shifts,
  baselines,
  onUpsert,
  onDelete,
}: {
  person: FlightBookPerson;
  shifts: FlightBookShiftRef[];
  baselines: FlightBookBaseline[];
  onUpsert: (baseline: FlightBookBaseline) => void;
  onDelete: (baselineId: string) => void;
}) {
  const [editing, setEditing] = useState<FlightBookBaseline | "new" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const personBaselines = useMemo(() => baselines
    .filter((item) => item.personId === person.id)
    .sort((left, right) => `${right.date}|${right.createdAt}`.localeCompare(`${left.date}|${left.createdAt}`)),
  [baselines, person.id]);
  const result = useMemo(
    () => buildFlightBook(person.id, shifts, baselines, person.aircraftTypes),
    [baselines, person.aircraftTypes, person.id, shifts],
  );

  return <div className="flight-book-layout">
    <section className="panel flight-book-summary">
      <div className="panel-heading"><div><p className="eyebrow">Лётная книжка</p><h2>Суммарный налёт</h2></div><div className="hero-actions"><button className="secondary-button" onClick={() => setImportOpen(true)}>Импорт из Excel</button><button className="primary-button" onClick={() => setEditing("new")}>+ Исходный налёт</button></div></div>
      <div className="flight-book-rule"><strong>Формула расчёта</strong><span>Последняя контрольная точка + полёты из единого журнала после её даты. Если исходный налёт не внесён, учитываются все записи сайта.</span></div>
      <div className="flight-book-metrics">
        <FlightMetric label="Общий налёт" value={result.total.totalMinutes} tone="teal" />
        <FlightMetric label="КВС" value={result.total.picMinutes} tone="navy" />
        <FlightMetric label="Инструктором" value={result.total.instructorMinutes} tone="violet" />
        <FlightMetric label="Ночью" value={result.total.nightMinutes} tone="blue" />
        <FlightMetric label="Добавлено сайтом" value={result.total.siteMinutes} tone="green" />
      </div>
      <div className="table-scroll"><table className="flight-book-table"><thead><tr><th>Тип ВС</th><th>Общий</th><th>КВС</th><th>2-й пилот</th><th>Пилот-инструктор</th><th>Ночь</th><th>ППП</th><th>Заходы ППП</th><th>Из журнала</th></tr></thead><tbody>
        {result.rows.map((row) => <tr key={row.aircraftType}><td><strong>{row.aircraftType}</strong></td><td><strong>{displayMinutes(row.totalMinutes)}</strong></td><td>{displayMinutes(row.picMinutes)}</td><td>{displayMinutes(row.secondPilotMinutes)}</td><td>{displayMinutes(row.instructorMinutes)}</td><td>{displayMinutes(row.nightMinutes)}</td><td>{displayMinutes(row.ifrMinutes)}</td><td>{row.ifrApproaches}</td><td><span className="site-flight-value">+ {displayMinutes(row.siteMinutes)}</span></td></tr>)}
        <tr className="flight-book-total"><td><strong>Всего на всех типах</strong></td><td><strong>{displayMinutes(result.total.totalMinutes)}</strong></td><td>{displayMinutes(result.total.picMinutes)}</td><td>{displayMinutes(result.total.secondPilotMinutes)}</td><td>{displayMinutes(result.total.instructorMinutes)}</td><td>{displayMinutes(result.total.nightMinutes)}</td><td>{displayMinutes(result.total.ifrMinutes)}</td><td>{result.total.ifrApproaches}</td><td><strong>+ {displayMinutes(result.total.siteMinutes)}</strong></td></tr>
      </tbody></table></div>
      <p className="flight-book-caveat">КВС, инструкторский и ночной налёт пополняются автоматически из журнала. Значения второго пилота, ППП и заходов ППП пока добавляются через исходный налёт.</p>
    </section>

    <section className="flight-book-bottom-grid">
      <article className="panel baseline-history">
        <div className="panel-heading"><div><p className="eyebrow">Исходные данные</p><h2>История исходного налёта</h2></div></div>
        {!personBaselines.length ? <div className="panel-empty">Исходный налёт ещё не внесён. Сумма строится только по журналу сайта.</div> : <div className="baseline-items">{personBaselines.map((baseline, index) => <div key={baseline.id} className={index === 0 ? "active" : ""}><div><strong>{displayDate(baseline.date)}</strong><span>{baseline.source || "Источник не указан"} · {baseline.rows.length} типов ВС</span></div><div>{index === 0 && <i>Используется</i>}<button onClick={() => setEditing(baseline)}>Изменить</button><button className="delete" onClick={() => {
          if (window.confirm(`Удалить контрольную точку от ${displayDate(baseline.date)}?`)) onDelete(baseline.id);
        }}>Удалить</button></div></div>)}</div>}
      </article>
      <article className="panel flight-book-log">
        <div className="panel-heading"><div><p className="eyebrow">После контрольной точки</p><h2>Полёты из журнала</h2></div><span className="count-badge">{result.entries.length}</span></div>
        {!result.entries.length ? <div className="panel-empty">После контрольной даты полётов в журнале пока нет.</div> : <div className="table-scroll"><table><thead><tr><th>Дата</th><th>Тип / борт</th><th>Кресло</th><th>Налёт</th><th>Ночь</th></tr></thead><tbody>{result.entries.slice(0, 50).map((entry) => <tr key={entry.id}><td>{displayDate(entry.date)}</td><td><strong>{entry.aircraftType}</strong><small>{entry.aircraft}</small></td><td>{entry.seat}</td><td><strong>{displayMinutes(entry.flightMinutes)}</strong></td><td>{displayMinutes(entry.nightMinutes)}</td></tr>)}</tbody></table></div>}
      </article>
    </section>

    {editing && <BaselineModal
      person={person}
      baseline={editing === "new" ? null : editing}
      onClose={() => setEditing(null)}
      onSave={(baseline) => { onUpsert(baseline); setEditing(null); }}
    />}
    {importOpen && <FlightBookImportModal
      person={person}
      onClose={() => setImportOpen(false)}
      onSave={(baseline) => { onUpsert(baseline); setImportOpen(false); }}
    />}
  </div>;
}

function FlightMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <article className={`flight-book-metric ${tone}`}><span>{label}</span><strong>{displayMinutes(value)}</strong></article>;
}

type DraftRow = {
  id: string;
  aircraftType: string;
  total: string;
  pic: string;
  secondPilot: string;
  instructor: string;
  night: string;
  ifr: string;
  ifrApproaches: string;
  note: string;
};

function durationDraft(minutes: number): string {
  return displayMinutes(minutes);
}

function compactDuration(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 6);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, -2)}:${digits.slice(-2)}`;
}

function parseDuration(value: string): number {
  if (!value.trim()) return 0;
  if (value.includes(":")) {
    const [hours = "0", minutes = "0"] = value.split(":");
    return Math.max(0, Number(hours || 0) * 60 + Math.min(59, Number(minutes || 0)));
  }
  return Math.max(0, Number(value) * 60);
}

function toDraftRow(row: FlightBookBaselineRow): DraftRow {
  return {
    id: row.id,
    aircraftType: row.aircraftType,
    total: durationDraft(row.totalMinutes),
    pic: durationDraft(row.picMinutes),
    secondPilot: durationDraft(row.secondPilotMinutes),
    instructor: durationDraft(row.instructorMinutes),
    night: durationDraft(row.nightMinutes),
    ifr: durationDraft(row.ifrMinutes),
    ifrApproaches: String(row.ifrApproaches || ""),
    note: row.note,
  };
}

function emptyDraftRow(aircraftType = ""): DraftRow {
  return {
    id: uid(),
    aircraftType,
    total: "0:00",
    pic: "0:00",
    secondPilot: "0:00",
    instructor: "0:00",
    night: "0:00",
    ifr: "0:00",
    ifrApproaches: "",
    note: "",
  };
}

function BaselineModal({
  person,
  baseline,
  onClose,
  onSave,
}: {
  person: FlightBookPerson;
  baseline: FlightBookBaseline | null;
  onClose: () => void;
  onSave: (baseline: FlightBookBaseline) => void;
}) {
  const [date, setDate] = useState(baseline?.date ?? localIsoDate());
  const [source, setSource] = useState(baseline?.source ?? "Личная лётная книжка");
  const [rows, setRows] = useState<DraftRow[]>(baseline?.rows.length
    ? baseline.rows.map(toDraftRow)
    : []);
  const [manualType, setManualType] = useState("");
  const updateRow = (rowId: string, patch: Partial<DraftRow>) =>
    setRows((current) => current.map((row) => row.id === rowId ? { ...row, ...patch } : row));
  const durationFields: Array<{ key: "total" | "pic" | "secondPilot" | "instructor" | "night" | "ifr"; label: string }> = [
    { key: "total", label: "Общий" },
    { key: "pic", label: "КВС" },
    { key: "secondPilot", label: "2-й пилот" },
    { key: "instructor", label: "Пилот-инструктор" },
    { key: "night", label: "Ночь" },
    { key: "ifr", label: "ППП" },
  ];
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal extra-wide" role="dialog" aria-modal="true"><header><div><p className="eyebrow">Лётная книжка · {person.name}</p><h2>{baseline ? "Изменить исходный налёт" : "Внести исходный налёт"}</h2><span>Это накопленный налёт на выбранную дату, а не отдельная запись о полёте</span></div><button className="modal-close" aria-label="Закрыть" onClick={onClose}>×</button></header><form className="form-stack" onSubmit={(event) => {
    event.preventDefault();
    const savedRows: FlightBookBaselineRow[] = rows.filter((row) => row.aircraftType.trim()).map((row) => ({
      id: row.id,
      aircraftType: row.aircraftType.trim(),
      totalMinutes: parseDuration(row.total),
      picMinutes: parseDuration(row.pic),
      secondPilotMinutes: parseDuration(row.secondPilot),
      instructorMinutes: parseDuration(row.instructor),
      nightMinutes: parseDuration(row.night),
      ifrMinutes: parseDuration(row.ifr),
      ifrApproaches: Math.max(0, Math.floor(Number(row.ifrApproaches) || 0)),
      note: "",
    }));
    if (!savedRows.length) return;
    onSave({
      id: baseline?.id ?? uid(),
      personId: person.id,
      date,
      source: source.trim(),
      note: "",
      rows: savedRows,
      createdAt: baseline?.createdAt ?? new Date().toISOString(),
    });
  }}>
    <div className="flight-book-form-note"><strong>Как считается итог</strong><span>Используется самая поздняя контрольная точка. К ней автоматически прибавляется налёт из полётных смен с последующих дат.</span></div>
    <div className="form-grid two"><label className="field"><span>Дата контрольной точки</span><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="field"><span>Источник</span><input value={source} onChange={(event) => setSource(event.target.value)} /></label></div>
    <fieldset className="flight-book-type-picker"><legend>Типы ВС сотрудника</legend>{person.aircraftTypes.map((aircraftType) => {
      const checked = rows.some((row) => row.aircraftType === aircraftType);
      return <label key={aircraftType}><input type="checkbox" checked={checked} onChange={() => setRows((current) => checked ? current.filter((row) => row.aircraftType !== aircraftType) : [...current, emptyDraftRow(aircraftType)])} /><span>{aircraftType}</span></label>;
    })}</fieldset>
    <div className="flight-book-manual-type"><label className="field"><span>Другого типа нет в списке</span><input value={manualType} onChange={(event) => setManualType(event.target.value)} placeholder="Ввести тип ВС вручную" /></label><button type="button" className="secondary-button" onClick={() => {
      const value = manualType.trim();
      if (value && !rows.some((row) => row.aircraftType.toLocaleLowerCase() === value.toLocaleLowerCase())) {
        setRows((current) => [...current, emptyDraftRow(value)]);
        setManualType("");
      }
    }}>Добавить тип</button></div>
    <div className="baseline-row-list">{rows.map((row) => <article key={row.id} className="baseline-row-card">
      <div className="baseline-row-title"><label className="field"><span>Тип ВС</span><input required list="flight-book-aircraft-types" value={row.aircraftType} onChange={(event) => updateRow(row.id, { aircraftType: event.target.value })} /></label><button type="button" className="danger-button compact" onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}>Удалить тип</button></div>
      <div className="baseline-duration-grid">{durationFields.map(({ key, label }) => <label className="field" key={key}><span>{label}</span><input inputMode="numeric" value={row[key]} onChange={(event) => updateRow(row.id, { [key]: compactDuration(event.target.value) })} onBlur={(event) => updateRow(row.id, { [key]: durationDraft(parseDuration(event.target.value)) })} /></label>)}<label className="field"><span>Заходы ППП</span><input inputMode="numeric" value={row.ifrApproaches} onChange={(event) => updateRow(row.id, { ifrApproaches: event.target.value.replace(/\D/g, "").slice(0, 4) })} /></label></div>
    </article>)}</div>
    <div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button">Сохранить исходный налёт</button></div>
  </form></section></div>;
}

function FlightBookImportModal({
  person,
  onClose,
  onSave,
}: {
  person: FlightBookPerson;
  onClose: () => void;
  onSave: (baseline: FlightBookBaseline) => void;
}) {
  const [preview, setPreview] = useState<FlightBookImportPreview | null>(null);
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(false);
  const blocking = preview?.issues.some((issue) => issue.level === "error") ?? true;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal extra-wide" role="dialog" aria-modal="true">
    <header><div><p className="eyebrow">Лётная книжка · {person.name}</p><h2>Импорт исходного налёта</h2><span>Сначала выполняется чтение и проверка. В базу ничего не попадёт до подтверждения.</span></div><button className="modal-close" aria-label="Закрыть" onClick={onClose}>×</button></header>
    <div className="form-stack">
      <label className="file-picker"><input type="file" accept=".xlsx,.xls,.csv" disabled={loading} onChange={async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setLoading(true);
        try {
          const XLSX = await import("xlsx");
          const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
          const previews = workbook.SheetNames.map((sheetName) => parseFlightBookImport(
            XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false }),
            `${file.name} · ${sheetName}`,
            person.aircraftTypes,
          ));
          let next = previews.sort((left, right) =>
            Number(right.format === "monthly") - Number(left.format === "monthly")
            || right.rows.length - left.rows.length
            || left.issues.filter((item) => item.level === "error").length - right.issues.filter((item) => item.level === "error").length)[0];
          if (next.format === "monthly") {
            const summary = previews.find((item) => item.format === "summary" && item.rows.length);
            const knownTypes = new Set(next.rows.map((row) => row.aircraftType.toLocaleUpperCase("ru-RU")));
            const historicalRows = (summary?.rows ?? []).filter((row) => !knownTypes.has(row.aircraftType.toLocaleUpperCase("ru-RU")));
            if (historicalRows.length) next = {
              ...next,
              source: `${file.name} · помесячный лист + исторические типы`,
              rows: [...next.rows, ...historicalRows],
              issues: [
                ...next.issues,
                ...historicalRows.map((row) => ({
                  level: "warning" as const,
                  row: 0,
                  message: `${row.aircraftType}: в исторической сводке нет колонки кресла — налёт включён только в общий.`,
                })),
              ],
            };
          }
          setPreview(next);
          setDate(next.date || localIsoDate());
        } finally {
          setLoading(false);
        }
      }} /><strong>{loading ? "Чтение файла…" : "Выбрать Excel с исходным налётом"}</strong><span>.xlsx, .xls или .csv</span></label>
      {preview && <>
        <div className="form-grid two"><label className="field"><span>Дата контрольной точки</span><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="field"><span>Источник</span><input readOnly value={preview.source} /></label></div>
        <div className="import-summary-grid"><article><span>Распознано типов ВС</span><strong>{preview.rows.length}</strong></article><article><span>Предупреждения</span><strong>{preview.issues.filter((item) => item.level === "warning").length}</strong></article><article><span>Ошибки</span><strong>{preview.issues.filter((item) => item.level === "error").length}</strong></article></div>
        {preview.issues.length > 0 && <div className="import-issues">{preview.issues.map((issue, index) => <div className={issue.level} key={`${issue.row}-${index}`}><strong>{issue.level === "error" ? "Ошибка" : "Проверить"}{issue.row ? ` · строка ${issue.row}` : ""}</strong><span>{issue.message}</span></div>)}</div>}
        <div className="table-scroll"><table className="flight-book-table"><thead><tr><th>Тип ВС</th><th>Общий</th><th>КВС</th><th>2-й пилот</th><th>Пилот-инструктор</th><th>Ночь</th><th>ППП</th><th>Заходы ППП</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.id}><td><strong>{row.aircraftType}</strong></td><td>{displayMinutes(row.totalMinutes)}</td><td>{displayMinutes(row.picMinutes)}</td><td>{displayMinutes(row.secondPilotMinutes)}</td><td>{displayMinutes(row.instructorMinutes)}</td><td>{displayMinutes(row.nightMinutes)}</td><td>{displayMinutes(row.ifrMinutes)}</td><td>{row.ifrApproaches}</td></tr>)}</tbody></table></div>
      </>}
      <div className="form-actions"><button className="secondary-button" type="button" onClick={onClose}>Отмена</button><button className="primary-button" type="button" disabled={!preview || blocking || !date || !preview.rows.length} onClick={() => {
        if (!preview) return;
        onSave({ id: uid(), personId: person.id, date, source: preview.source, note: "", rows: preview.rows.map((row) => ({ ...row, id: uid() })), createdAt: new Date().toISOString() });
      }}>Подтвердить импорт</button></div>
    </div>
  </section></div>;
}
