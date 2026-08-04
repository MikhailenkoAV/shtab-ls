"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { getExpiryState, isExpiryAttention, latestCertificationRecords } from "./personal-files-rules";
import { FlightBookView } from "./flight-book";
import {
  buildFlightBook,
  FlightBookBaseline,
} from "./flight-book-rules";

export { getExpiryState, type ExpiryState } from "./personal-files-rules";

export type PersonRef = {
  id: string;
  name: string;
  position: string;
  permissions: string[];
  aircraftTypes: string[];
  qualifications: {
    operators: string[];
    aircraftTypes: string[];
    seats: string[];
    nightAircraftTypes?: string[];
  }[];
  active: boolean;
};
export type FlightTimeShiftRef = {
  id?: string;
  personId: string;
  date: string;
  activity: string;
  segments: {
    id?: string;
    aircraft: string;
    aircraftType?: string;
    seat?: string;
    purpose?: string;
    flightMinutes: number;
    nightMinutes: number;
  }[];
};
export type CertificationRecord = {
  id: string; personId: string; category: string; certificationType: string; aircraftType: string;
  organization: string; issuedDate: string; startDate: string; endDate: string; documentType: string;
  grade: string; series: string; number: string; documentAvailable: string; note: string;
  operator?: string;
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

type PersonalMode = "overview" | "records" | "flightbook";
type PersonalSection = {
  id: string;
  title: string;
  detail: string;
  pattern?: RegExp;
  special?: "flightbook";
};
const personalGroups: { title: string; sections: PersonalSection[] }[] = [
  {
    title: "1. Личные и базовые данные",
    sections: [
      { id: "all", title: "Карточка", detail: "анкета, сводка и все записи" },
      { id: "education", title: "Образование", detail: "документы об обучении", pattern: /образован|диплом|обучен|удостоверен/i },
      { id: "licences", title: "Свидетельства", detail: "типы ВС и копии", pattern: /свидетельств|лиценз|сертификат/i },
      { id: "medicine", title: "Медицина", detail: "ВЛЭК и осмотры", pattern: /влэк|медиц|осмотр|заключен/i },
      { id: "documents", title: "Личные документы", detail: "паспорт, СНИЛС, ИНН", pattern: /паспорт|снилс|инн|личн.*документ/i },
    ],
  },
  {
    title: "2. Эксплуатация и подготовка",
    sections: [
      { id: "authority", title: "Полномочия", detail: "проверяющий, инструктор", pattern: /полномоч|инструктор|экзамен|проверяющ/i },
      { id: "flight-kinds", title: "Виды полётов", detail: "горы, ППП, авиаработы", pattern: /вид.*пол|горн|ппп|авиаработ|допуск/i },
      { id: "flightbook", title: "Лётная книжка", detail: "исходный и общий налёт", special: "flightbook" },
      { id: "minimums", title: "Минимумы", detail: "ПВП, ППП и приказы", pattern: /минимум|пвп|ппп/i },
      { id: "flight-training", title: "Лётная подготовка", detail: "проверки и тренажи", pattern: /провер|тренаж|л[её]тн.*подготов/i },
      { id: "periodic", title: "Периодика", detail: "КПК, АСП, CRM, английский", pattern: /кпк|асп|crm|англий|период/i },
    ],
  },
  {
    title: "3. Файлы и история",
    sections: [
      { id: "files", title: "Файлы", detail: "копии и источники документов", pattern: /./ },
      { id: "history", title: "Журнал изменений", detail: "кто и когда менял данные", pattern: /./ },
    ],
  },
];

function recordText(record: CertificationRecord): string {
  return `${record.category} ${record.certificationType} ${record.aircraftType} ${record.organization} ${record.documentType} ${record.number} ${record.note}`;
}

export function PersonalFilesView({
  people,
  shifts,
  records,
  baselines,
  onImportClick,
  onUpsert,
  onDelete,
  onUpsertBaseline,
  onDeleteBaseline,
}: {
  people: PersonRef[];
  shifts: FlightTimeShiftRef[];
  records: CertificationRecord[];
  baselines: FlightBookBaseline[];
  onImportClick: () => void;
  onUpsert: (record: CertificationRecord) => void;
  onDelete: (id: string) => void;
  onUpsertBaseline: (baseline: FlightBookBaseline) => void;
  onDeleteBaseline: (baselineId: string) => void;
}) {
  const sortedPeople = useMemo(() => [...people].sort((left, right) => left.name.localeCompare(right.name, "ru-RU")), [people]);
  const defaultPerson = sortedPeople.find((person) => records.some((record) => record.personId === person.id))?.id ?? sortedPeople[0]?.id ?? "";
  const [selected, setSelected] = useState(defaultPerson); const [query, setQuery] = useState(""); const [attentionOnly, setAttentionOnly] = useState(false); const [editing, setEditing] = useState<CertificationRecord | "new" | null>(null);
  const [mode, setMode] = useState<PersonalMode>("overview");
  const [recordSection, setRecordSection] = useState("all");
  const [operatorFilter, setOperatorFilter] = useState(""); const [aircraftFilter, setAircraftFilter] = useState(""); const [seatFilter, setSeatFilter] = useState("");
  const operatorOptions = useMemo(() => [...new Set(people.flatMap((person) => person.qualifications.flatMap((qualification) => qualification.operators)))].sort((left, right) => left.localeCompare(right, "ru-RU")), [people]);
  const aircraftOptions = useMemo(() => [...new Set(people.flatMap((person) => person.qualifications.flatMap((qualification) => qualification.aircraftTypes)))].sort((left, right) => left.localeCompare(right, "ru-RU")), [people]);
  const seatOptions = useMemo(() => [...new Set(people.flatMap((person) => person.qualifications.flatMap((qualification) => qualification.seats)))].sort((left, right) => left.localeCompare(right, "ru-RU")), [people]);
  const filteredPeople = useMemo(() => sortedPeople.filter((person) => person.qualifications.some((qualification) =>
    (!operatorFilter || qualification.operators.includes(operatorFilter))
    && (!aircraftFilter || qualification.aircraftTypes.includes(aircraftFilter))
    && (!seatFilter || qualification.seats.includes(seatFilter)))), [aircraftFilter, operatorFilter, seatFilter, sortedPeople]);
  const personId = filteredPeople.some((person) => person.id === selected) ? selected : filteredPeople[0]?.id ?? ""; const person = people.find((item) => item.id === personId);
  const personRecords = useMemo(() => records.filter((record) => record.personId === personId).sort((a, b) => {
    const order = { expired: 0, alert14: 1, alert45: 2, incomplete: 3, valid: 4, undated: 5 };
    return order[getExpiryState(a).level] - order[getExpiryState(b).level] || (a.endDate || "9999").localeCompare(b.endDate || "9999");
  }), [records, personId]);
  const currentPersonRecords = latestCertificationRecords(personRecords);
  const counts = currentPersonRecords.reduce((result, record) => {
    const state = getExpiryState(record);
    if (state.level !== "incomplete" || isExpiryAttention(record)) result[state.level] += 1;
    return result;
  }, { expired: 0, alert14: 0, alert45: 0, valid: 0, undated: 0, incomplete: 0 });
  const today = new Date(); const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const currentMonthFlight = shifts.filter((shift) => shift.personId === personId && shift.activity === "flight" && shift.date.startsWith(monthKey)).reduce((total, shift) => total + shift.segments.reduce((sum, segment) => sum + Math.max(0, segment.flightMinutes || 0), 0), 0);
  const flightBook = useMemo(
    () => buildFlightBook(personId, shifts, baselines, person?.aircraftTypes ?? []),
    [baselines, person?.aircraftTypes, personId, shifts],
  );
  const section = personalGroups.flatMap((group) => group.sections).find((item) => item.id === recordSection);
  const sectionRecords = personRecords.filter((record) =>
    recordSection === "all"
    || recordSection === "files" && Boolean(record.sourceFile || record.documentAvailable)
    || recordSection === "history"
    || Boolean(section?.pattern?.test(recordText(record))));
  const visible = sectionRecords.filter((record) => {
    const matchesStatus = !attentionOnly || currentPersonRecords.some((current) => current.id === record.id) && isExpiryAttention(record);
    return matchesStatus && recordText(record).toLocaleLowerCase("ru-RU").includes(query.trim().toLocaleLowerCase("ru-RU"));
  });
  if (!people.length) return <section className="empty-start"><div className="empty-visual"><span>ЛД</span><i /></div><p className="eyebrow">Личные дела</p><h2>Загрузите первую выгрузку Авиабит</h2><p>Сайт создаст карточку пилота, перенесёт сертификации и рассчитает сроки. Файл обрабатывается только на этом устройстве.</p><button className="primary-button" onClick={onImportClick}>Загрузить Excel</button></section>;
  return <div className="records-layout"><aside className="pilot-list panel"><div className="panel-heading"><div><p className="eyebrow">Лётный состав</p><h2>Личные дела</h2></div><button className="icon-button" onClick={onImportClick} title="Импорт из Авиабит">＋</button></div><div className="pilot-filters"><select value={operatorFilter} onChange={(event) => setOperatorFilter(event.target.value)}><option value="">Все эксплуатанты</option>{operatorOptions.map((item) => <option key={item}>{item}</option>)}</select><select value={aircraftFilter} onChange={(event) => setAircraftFilter(event.target.value)}><option value="">Все типы ВС</option>{aircraftOptions.map((item) => <option key={item}>{item}</option>)}</select><select value={seatFilter} onChange={(event) => setSeatFilter(event.target.value)}><option value="">Все кресла</option>{seatOptions.map((item) => <option key={item}>{item}</option>)}</select></div><div className="pilot-items">{filteredPeople.map((item) => { const itemRecords = records.filter((record) => record.personId === item.id); const warnings = latestCertificationRecords(itemRecords).filter((record) => isExpiryAttention(record)).length; const total = buildFlightBook(item.id, shifts, baselines, item.aircraftTypes).total.totalMinutes; return <button key={item.id} className={item.id === personId ? "active" : ""} onClick={() => { setSelected(item.id); setMode("overview"); }}><span className="person-avatar small">{item.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span><span><strong>{item.name}</strong><small>{displayMinutes(total)} · {itemRecords.length} записей</small></span>{warnings > 0 && <i>{warnings}</i>}</button>; })}{!filteredPeople.length && <div className="pilot-filter-empty">Сотрудники по фильтрам не найдены.</div>}</div></aside>
    {!person ? <section className="records-main"><div className="panel panel-empty tall">Измените фильтры, чтобы выбрать сотрудника.</div></section> : <section className="records-main"><div className="record-hero panel"><div className="record-person"><p className="eyebrow">Личное дело</p><h2>{person.name}</h2><span>{[person.position, person.aircraftTypes.join(", ")].filter(Boolean).join(" · ")}</span></div><div className="record-hero-side"><div className="record-flight-cards"><div className="monthly-flight-card"><span>Налёт в текущем месяце</span><strong>{displayMinutes(currentMonthFlight)}</strong></div><div className="monthly-flight-card total"><span>Общий налёт по книжке</span><strong>{displayMinutes(flightBook.total.totalMinutes)}</strong></div></div><div className="hero-actions"><button className="secondary-button" onClick={() => setEditing("new")}>+ Запись</button><button className="primary-button" onClick={onImportClick}>Импорт Авиабит</button></div></div></div>
      <div className="personal-view-tabs"><button className={mode === "overview" ? "active" : ""} onClick={() => setMode("overview")}>Обзор</button><button className={mode === "records" ? "active" : ""} onClick={() => { setRecordSection("all"); setMode("records"); }}>Документы и сроки</button><button className={mode === "flightbook" ? "active" : ""} onClick={() => setMode("flightbook")}>Лётная книжка</button></div>
      {mode !== "flightbook" && <div className="record-metrics"><RecordMetric value={counts.expired} label="просрочено" tone="danger" /><RecordMetric value={counts.alert14} label="до 14 дней" tone="alert14" /><RecordMetric value={counts.alert45} label="15–45 дней" tone="alert45" /><RecordMetric value={counts.incomplete} label="нет данных" tone="neutral" /></div>}
      {mode === "overview" ? <section className="personal-section-groups">{personalGroups.map((group) => <article className="panel personal-section-group" key={group.title}><h3>{group.title}</h3><div>{group.sections.map((item) => {
        const itemCount = item.special === "flightbook" ? flightBook.rows.length : item.id === "all" ? personRecords.length : personRecords.filter((record) =>
          item.id === "files" ? Boolean(record.sourceFile || record.documentAvailable) : item.pattern?.test(recordText(record))).length;
        return <button key={item.id} onClick={() => {
          if (item.special === "flightbook") setMode("flightbook");
          else { setRecordSection(item.id); setMode("records"); }
        }}><span><strong>{item.title}</strong><small>{item.detail}</small></span><i>{item.special === "flightbook" ? displayMinutes(flightBook.total.totalMinutes) : itemCount}</i></button>;
      })}</div></article>)}</section>
        : mode === "records" ? <section className="panel records-panel"><div className="panel-heading"><div><p className="eyebrow">Личное дело</p><h2>{section?.title ?? "Документы и сроки"}</h2></div><button className="secondary-button" onClick={() => setMode("overview")}>← К разделам</button></div><div className="records-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по личному делу…" /><div className="filter-buttons"><button className={!attentionOnly ? "active" : ""} onClick={() => setAttentionOnly(false)}>Все</button><button className={attentionOnly ? "active" : ""} onClick={() => setAttentionOnly(true)}>Требует внимания</button></div></div>
          {!personRecords.length ? <div className="panel-empty tall">В личном деле пока нет записей. Загрузите Excel из Авиабит или добавьте запись вручную.</div> : !visible.length ? <div className="panel-empty">В этом разделе записей пока нет.</div> : <div className="table-scroll"><table className="records-table"><thead><tr><th>Сертификация</th><th>Тип / ВС</th><th>Документ</th><th>Начало</th><th>Конец</th><th>Состояние</th><th /></tr></thead><tbody>{visible.map((record) => { const state = getExpiryState(record); return <tr key={record.id}><td><strong>{record.certificationType || record.category || "—"}</strong><small>{record.category}</small>{recordSection === "history" && <small>{record.source === "aviabit" ? "Импорт Авиабит" : "Ручная запись"} · {displayDate(record.importedAt.slice(0, 10))}</small>}</td><td>{record.aircraftType || "—"}</td><td>{[record.documentType, record.series, record.number].filter(Boolean).join(" · ") || "—"}{recordSection === "files" && record.sourceFile && <small>{record.sourceFile}</small>}</td><td>{displayDate(record.startDate)}</td><td>{displayDate(record.endDate)}</td><td><span className={`expiry-pill ${state.level}`}>{state.label}</span></td><td><button className="row-action" onClick={() => setEditing(record)}>Изменить</button></td></tr>; })}</tbody></table></div>}
        </section>
          : <FlightBookView person={person} shifts={shifts} baselines={baselines} onUpsert={onUpsertBaseline} onDelete={onDeleteBaseline} />}
    </section>}
    {editing && person && <RecordModal personId={person.id} record={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={(record) => { onUpsert(record); setEditing(null); }} onDelete={editing === "new" ? undefined : () => { if (window.confirm("Удалить запись из личного дела?")) { onDelete(editing.id); setEditing(null); } }} />}</div>;
}
function RecordMetric({ value, label, tone }: { value: number; label: string; tone: string }) { return <article className={`record-metric ${tone}`}><strong>{value}</strong><span>{label}</span></article>; }

export function ImportAviabitModal({ people, onClose, onSubmit }: { people: PersonRef[]; onClose: () => void; onSubmit: (payload: ImportPayload) => void }) {
  const [parsed, setParsed] = useState<{ personName: string; records: CertificationRecord[] } | null>(null); const [target, setTarget] = useState("__new__"); const [name, setName] = useState(""); const [error, setError] = useState(""); const [reading, setReading] = useState(false);
  async function read(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; setReading(true); setError(""); try { const result = await parseAviabit(file); setParsed(result); setName(result.personName); const match = people.find((person) => personKey(person.name) === personKey(result.personName)); setTarget(match?.id ?? "__new__"); } catch (caught) { setParsed(null); setError(caught instanceof Error ? caught.message : "Не удалось прочитать файл"); } finally { setReading(false); event.target.value = ""; } }
  const summary = parsed?.records.reduce((result, record) => {
    const state = getExpiryState(record);
    if (state.level !== "incomplete" || isExpiryAttention(record)) result[state.level] += 1;
    return result;
  }, { expired: 0, alert14: 0, alert45: 0, valid: 0, undated: 0, incomplete: 0 });
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
