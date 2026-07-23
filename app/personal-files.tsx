"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { getExpiryState } from "./personal-files-rules";

export { getExpiryState, type ExpiryState } from "./personal-files-rules";

export type PersonRef = { id: string; name: string; position: string; aircraftTypes: string[]; active: boolean };
export type FlightTimeShiftRef = { personId: string; date: string; activity: string; segments: { flightMinutes: number }[] };
export type CertificationRecord = {
  id: string; personId: string; category: string; certificationType: string; aircraftType: string;
  organization: string; issuedDate: string; startDate: string; endDate: string; documentType: string;
  grade: string; series: string; number: string; documentAvailable: string; note: string;
  source: "aviabit" | "manual"; sourceFile: string; importedAt: string;
};
export type ImportPayload = { targetPersonId: string | null; personName: string; records: CertificationRecord[] };
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const text = (value: unknown) => String(value ?? "").trim();
const header = (value: unknown) => text(value).toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");

function isoDate(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  if (typeof value === "number") { const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`; }
  const ru = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(text(value));
  if (ru) { const year = +ru[3] < 100 ? 2000 + +ru[3] : +ru[3]; return `${year}-${String(+ru[2]).padStart(2, "0")}-${String(+ru[1]).padStart(2, "0")}`; }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text(value));
  return iso ? `${iso[1]}-${String(+iso[2]).padStart(2, "0")}-${String(+iso[3]).padStart(2, "0")}` : "";
}
function displayDate(value: string) { return value ? new Intl.DateTimeFormat("ru-RU").format(new Date(`${value}T12:00:00`)) : "—"; }
function displayMinutes(minutes: number) { return `${Math.floor(minutes / 60)} ч ${String(minutes % 60).padStart(2, "0")} мин`; }
function personKey(name: string) { const parts = name.toLocaleLowerCase("ru-RU").replace(/[^а-яёa-z -]/g, " ").split(/\s+/).filter(Boolean); return parts.length >= 3 ? `${parts[0]} ${parts[1][0]} ${parts[2][0]}` : parts.join(" "); }
function personName(fileName: string, rows: unknown[][]) {
  const base = fileName.replace(/\.(xlsx?|csv)$/i, "").trim();
  if (base.split(/\s+/).length >= 2 && !/сертификац|выгруз|отч[её]т/i.test(base)) return base;
  const filter = rows.slice(0, 5).flat().map(text).find((value) => /Фильтр:\s*Работники/i.test(value)) ?? "";
  return filter.replace(/^.*?Работники\s*/i, "").replace(/[;.]$/, "").trim() || "Новый сотрудник";
}

async function parseAviabit(file: File) {
  const XLSX = await import("xlsx");
  const book = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]]; if (!sheet) throw new Error("В книге нет листов");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
  const headerRow = rows.findIndex((row) => { const values = row.map(header); return values.includes("сертификация") && values.includes("тип сертификации") && values.includes("конец"); });
  if (headerRow < 0) throw new Error("Не найдена строка заголовков Авиабит");
  const columns = rows[headerRow].map(header); const at = (row: unknown[], name: string) => { const index = columns.indexOf(header(name)); return index >= 0 ? row[index] : ""; };
  const importedAt = new Date().toISOString();
  const records = rows.slice(headerRow + 1).filter((row) => text(at(row, "Сертификация")) || text(at(row, "Тип сертификации"))).map((row): CertificationRecord => ({
    id: uid(), personId: "", category: text(at(row, "Сертификация")), certificationType: text(at(row, "Тип сертификации")), aircraftType: text(at(row, "Тип/Модиф")), organization: text(at(row, "Организация")),
    issuedDate: isoDate(at(row, "Выдан")), startDate: isoDate(at(row, "Начало")), endDate: isoDate(at(row, "Конец")), documentType: text(at(row, "Сертификат/Документ")), grade: text(at(row, "Оценка")), series: text(at(row, "Серия")), number: text(at(row, "Номер")), documentAvailable: text(at(row, "Наличие документа")), note: text(at(row, "Доп сведения")),
    source: "aviabit", sourceFile: file.name, importedAt,
  }));
  if (!records.length) throw new Error("Выгрузка не содержит записей");
  return { personName: personName(file.name, rows), records };
}

export function PersonalFilesView({ people, shifts, records, onImportClick, onUpsert, onDelete }: { people: PersonRef[]; shifts: FlightTimeShiftRef[]; records: CertificationRecord[]; onImportClick: () => void; onUpsert: (record: CertificationRecord) => void; onDelete: (id: string) => void }) {
  const defaultPerson = people.find((person) => records.some((record) => record.personId === person.id))?.id ?? people[0]?.id ?? "";
  const [selected, setSelected] = useState(defaultPerson); const [query, setQuery] = useState(""); const [attentionOnly, setAttentionOnly] = useState(false); const [editing, setEditing] = useState<CertificationRecord | "new" | null>(null);
  const personId = people.some((person) => person.id === selected) ? selected : people[0]?.id ?? ""; const person = people.find((item) => item.id === personId);
  const personRecords = useMemo(() => records.filter((record) => record.personId === personId).sort((a, b) => {
    const order = { expired: 0, alert14: 1, alert45: 2, incomplete: 3, valid: 4, undated: 5 };
    return order[getExpiryState(a).level] - order[getExpiryState(b).level] || (a.endDate || "9999").localeCompare(b.endDate || "9999");
  }), [records, personId]);
  const counts = personRecords.reduce((result, record) => { result[getExpiryState(record).level] += 1; return result; }, { expired: 0, alert14: 0, alert45: 0, valid: 0, undated: 0, incomplete: 0 });
  const today = new Date(); const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const currentMonthFlight = shifts.filter((shift) => shift.personId === personId && shift.activity === "flight" && shift.date.startsWith(monthKey)).reduce((total, shift) => total + shift.segments.reduce((sum, segment) => sum + Math.max(0, segment.flightMinutes || 0), 0), 0);
  const visible = personRecords.filter((record) => { const state = getExpiryState(record); const matchesStatus = !attentionOnly || ["expired", "alert14", "alert45", "incomplete"].includes(state.level); return matchesStatus && `${record.category} ${record.certificationType} ${record.aircraftType} ${record.organization} ${record.number}`.toLocaleLowerCase("ru-RU").includes(query.trim().toLocaleLowerCase("ru-RU")); });
  if (!people.length) return <section className="empty-start"><div className="empty-visual"><span>ЛД</span><i /></div><p className="eyebrow">Личные дела</p><h2>Загрузите первую выгрузку Авиабит</h2><p>Сайт создаст карточку пилота, перенесёт сертификации и рассчитает сроки. Файл обрабатывается только на этом устройстве.</p><button className="primary-button" onClick={onImportClick}>Загрузить Excel</button></section>;
  return <div className="records-layout"><aside className="pilot-list panel"><div className="panel-heading"><div><p className="eyebrow">Лётный состав</p><h2>Личные дела</h2></div><button className="icon-button" onClick={onImportClick} title="Импорт из Авиабит">＋</button></div><div className="pilot-items">{people.map((item) => { const itemRecords = records.filter((record) => record.personId === item.id); const warnings = itemRecords.filter((record) => ["expired", "alert14", "alert45", "incomplete"].includes(getExpiryState(record).level)).length; return <button key={item.id} className={item.id === personId ? "active" : ""} onClick={() => setSelected(item.id)}><span className="person-avatar small">{item.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span><span><strong>{item.name}</strong><small>{itemRecords.length} записей</small></span>{warnings > 0 && <i>{warnings}</i>}</button>; })}</div></aside>
    <section className="records-main"><div className="record-hero panel"><div className="record-person"><p className="eyebrow">Личное дело</p><h2>{person?.name}</h2><span>{person?.position}</span></div><div className="record-hero-side"><div className="monthly-flight-card"><span>Налёт в текущем месяце</span><strong>{displayMinutes(currentMonthFlight)}</strong></div><div className="hero-actions"><button className="secondary-button" onClick={() => setEditing("new")}>+ Запись</button><button className="primary-button" onClick={onImportClick}>Импорт Авиабит</button></div></div></div>
      <div className="record-metrics"><RecordMetric value={counts.expired} label="просрочено" tone="danger" /><RecordMetric value={counts.alert14} label="до 14 дней" tone="alert14" /><RecordMetric value={counts.alert45} label="15–45 дней" tone="alert45" /><RecordMetric value={counts.incomplete} label="нет данных" tone="neutral" /></div>
      <section className="panel records-panel"><div className="records-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по личному делу…" /><div className="filter-buttons"><button className={!attentionOnly ? "active" : ""} onClick={() => setAttentionOnly(false)}>Все</button><button className={attentionOnly ? "active" : ""} onClick={() => setAttentionOnly(true)}>Требует внимания</button></div></div>
        {!personRecords.length ? <div className="panel-empty tall">В личном деле пока нет записей. Загрузите Excel из Авиабит или добавьте запись вручную.</div> : !visible.length ? <div className="panel-empty">По выбранному фильтру записей нет.</div> : <div className="table-scroll"><table className="records-table"><thead><tr><th>Сертификация</th><th>Тип / ВС</th><th>Документ</th><th>Начало</th><th>Конец</th><th>Состояние</th><th /></tr></thead><tbody>{visible.map((record) => { const state = getExpiryState(record); return <tr key={record.id}><td><strong>{record.certificationType || record.category || "—"}</strong><small>{record.category}</small></td><td>{record.aircraftType || "—"}</td><td>{[record.documentType, record.series, record.number].filter(Boolean).join(" · ") || "—"}</td><td>{displayDate(record.startDate)}</td><td>{displayDate(record.endDate)}</td><td><span className={`expiry-pill ${state.level}`}>{state.label}</span></td><td><button className="row-action" onClick={() => setEditing(record)}>Изменить</button></td></tr>; })}</tbody></table></div>}
      </section></section>
    {editing && person && <RecordModal personId={person.id} record={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={(record) => { onUpsert(record); setEditing(null); }} onDelete={editing === "new" ? undefined : () => { if (window.confirm("Удалить запись из личного дела?")) { onDelete(editing.id); setEditing(null); } }} />}</div>;
}
function RecordMetric({ value, label, tone }: { value: number; label: string; tone: string }) { return <article className={`record-metric ${tone}`}><strong>{value}</strong><span>{label}</span></article>; }

export function ImportAviabitModal({ people, onClose, onSubmit }: { people: PersonRef[]; onClose: () => void; onSubmit: (payload: ImportPayload) => void }) {
  const [parsed, setParsed] = useState<{ personName: string; records: CertificationRecord[] } | null>(null); const [target, setTarget] = useState("__new__"); const [name, setName] = useState(""); const [error, setError] = useState(""); const [reading, setReading] = useState(false);
  async function read(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; setReading(true); setError(""); try { const result = await parseAviabit(file); setParsed(result); setName(result.personName); const match = people.find((person) => personKey(person.name) === personKey(result.personName)); setTarget(match?.id ?? "__new__"); } catch (caught) { setParsed(null); setError(caught instanceof Error ? caught.message : "Не удалось прочитать файл"); } finally { setReading(false); event.target.value = ""; } }
  const summary = parsed?.records.reduce((result, record) => { result[getExpiryState(record).level] += 1; return result; }, { expired: 0, alert14: 0, alert45: 0, valid: 0, undated: 0, incomplete: 0 });
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal wide" role="dialog" aria-modal="true"><header><div><p className="eyebrow">Личное дело</p><h2>Импорт из Авиабит</h2><span>Поддерживается выгрузка «Сертификации» в Excel</span></div><button className="modal-close" aria-label="Закрыть" onClick={onClose}>×</button></header><form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (parsed && name.trim()) onSubmit({ targetPersonId: target === "__new__" ? null : target, personName: name.trim(), records: parsed.records }); }}>
    <label className="file-drop"><input hidden type="file" accept=".xlsx,.xls,.csv" onChange={read} /><span>{reading ? "Читаю выгрузку…" : parsed ? "Выбрать другой Excel" : "Выбрать Excel из Авиабит"}</span><small>Файл никуда не отправляется и обрабатывается в браузере</small></label>{error && <div className="import-error">{error}</div>}
    {parsed && <><div className="import-summary"><div><strong>{parsed.records.length}</strong><span>строк найдено</span></div><div><strong>{summary?.expired ?? 0}</strong><span>просрочено</span></div><div><strong>{(summary?.alert14 ?? 0) + (summary?.alert45 ?? 0)}</strong><span>истекает за 45 дней</span></div><div><strong>{summary?.incomplete ?? 0}</strong><span>нет данных</span></div></div><div className="form-grid two"><label className="field"><span>Карточка сотрудника</span><select value={target} onChange={(event) => setTarget(event.target.value)}><option value="__new__">Создать новую карточку</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="field"><span>Ф. И. О.</span><input required disabled={target !== "__new__"} value={target === "__new__" ? name : people.find((person) => person.id === target)?.name ?? ""} onChange={(event) => setName(event.target.value)} /></label></div><div className="import-note"><strong>При повторной загрузке</strong><span>Записи Авиабит выбранного сотрудника обновятся; ручные записи сохранятся.</span></div></>}
    <div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button" disabled={!parsed || !name.trim()}>Импортировать</button></div></form></section></div>;
}

function RecordModal({ personId, record, onClose, onSave, onDelete }: { personId: string; record: CertificationRecord | null; onClose: () => void; onSave: (record: CertificationRecord) => void; onDelete?: () => void }) {
  const [form, setForm] = useState<CertificationRecord>(record ?? { id: uid(), personId, category: "Ограничение", certificationType: "", aircraftType: "", organization: "", issuedDate: "", startDate: "", endDate: "", documentType: "", grade: "", series: "", number: "", documentAvailable: "", note: "", source: "manual", sourceFile: "", importedAt: new Date().toISOString() }); const update = (key: keyof CertificationRecord, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <div className="modal-backdrop" role="presentation"><section className="modal wide" role="dialog" aria-modal="true"><header><div><p className="eyebrow">Личное дело</p><h2>{record ? "Изменить запись" : "Новая запись"}</h2><span>Ручные данные хранятся только на этом устройстве</span></div><button className="modal-close" aria-label="Закрыть" onClick={onClose}>×</button></header><form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (form.certificationType.trim()) onSave({ ...form, source: "manual", importedAt: new Date().toISOString() }); }}>
    <div className="form-grid two"><Field label="Раздел" value={form.category} onChange={(value) => update("category", value)} /><Field label="Тип сертификации" value={form.certificationType} onChange={(value) => update("certificationType", value)} required /></div><div className="form-grid two"><Field label="Тип / модификация ВС" value={form.aircraftType} onChange={(value) => update("aircraftType", value)} /><Field label="Организация" value={form.organization} onChange={(value) => update("organization", value)} /></div><div className="form-grid three"><Field label="Выдан" value={form.issuedDate} onChange={(value) => update("issuedDate", value)} type="date" /><Field label="Начало" value={form.startDate} onChange={(value) => update("startDate", value)} type="date" /><Field label="Конец" value={form.endDate} onChange={(value) => update("endDate", value)} type="date" /></div><div className="form-grid three"><Field label="Документ" value={form.documentType} onChange={(value) => update("documentType", value)} /><Field label="Серия" value={form.series} onChange={(value) => update("series", value)} /><Field label="Номер" value={form.number} onChange={(value) => update("number", value)} /></div><label className="field"><span>Дополнительные сведения</span><textarea value={form.note} onChange={(event) => update("note", event.target.value)} /></label><div className="form-actions split">{onDelete && <button type="button" className="danger-button" onClick={onDelete}>Удалить</button>}<span /><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button">Сохранить</button></div></form></section></div>;
}
function Field({ label, value, onChange, type = "text", required }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) { return <label className="field"><span>{label}</span><input required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
