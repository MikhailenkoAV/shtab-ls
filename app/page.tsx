"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CertificationRecord, getExpiryState, ImportAviabitModal, ImportPayload, PersonalFilesView } from "./personal-files";

type View = "dashboard" | "shifts" | "people" | "personal";
type Activity = "flight" | "duty" | "office" | "training" | "trip" | "vacation" | "dayoff";

type Person = { id: string; name: string; position: string; aircraftTypes: string[]; active: boolean };
type Segment = { id: string; aircraft: string; purpose: string; flightMinutes: number; nightMinutes: number };
type Shift = {
  id: string; personId: string; date: string; activity: Activity; start: string; workMinutes: number;
  status: "planned" | "actual" | "confirmed"; segments: Segment[]; note: string; createdAt: string;
};
type AppData = { people: Person[]; shifts: Shift[]; certifications: CertificationRecord[] };

const EMPTY_DATA: AppData = { people: [], shifts: [], certifications: [] };
const DB_NAME = "shtab-ls";
const STORE_NAME = "workspace";
const STATE_KEY = "primary";
const activityLabels: Record<Activity, string> = {
  flight: "Полётная работа", duty: "Дежурство", office: "Работа в офисе", training: "Подготовка / АУЦ",
  trip: "Командировка", vacation: "Отпуск", dayoff: "Выходной",
};
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadData(): Promise<AppData> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(STATE_KEY);
    request.onsuccess = () => { const stored = request.result as Partial<AppData> | undefined; resolve({ people: stored?.people ?? [], shifts: stored?.shifts ?? [], certifications: stored?.certifications ?? [] }); };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function saveData(data: AppData): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(data, STATE_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

function parseDuration(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Math.max(0, Number(hours) * 60 + Number(minutes));
}
function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes)) return "—";
  const sign = minutes < 0 ? "−" : "";
  const absolute = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(absolute / 60)} ч ${String(absolute % 60).padStart(2, "0")} мин`;
}
function shiftStart(shift: Shift): Date | null {
  if (!shift.start || !shift.date || !shift.workMinutes) return null;
  const date = new Date(`${shift.date}T${shift.start}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
function shiftEnd(shift: Shift): Date | null {
  const start = shiftStart(shift);
  return start ? new Date(start.getTime() + shift.workMinutes * 60_000) : null;
}
function formatDate(value: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(`${value}T12:00:00`)).replace(" г.", "");
}
function formatClock(date: Date | null): string {
  return date ? new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date) : "—";
}
function isWorkActivity(activity: Activity): boolean { return !["vacation", "dayoff"].includes(activity); }

function getRestMap(shifts: Shift[]): Map<string, number> {
  const map = new Map<string, number>();
  const groups = new Map<string, Shift[]>();
  shifts.filter((shift) => isWorkActivity(shift.activity) && shiftStart(shift)).forEach((shift) => {
    groups.set(shift.personId, [...(groups.get(shift.personId) ?? []), shift]);
  });
  groups.forEach((items) => {
    items.sort((a, b) => (shiftStart(a)?.getTime() ?? 0) - (shiftStart(b)?.getTime() ?? 0));
    items.forEach((shift, index) => {
      if (!index) return;
      const previousEnd = shiftEnd(items[index - 1]);
      const currentStart = shiftStart(shift);
      if (previousEnd && currentStart) map.set(shift.id, (currentStart.getTime() - previousEnd.getTime()) / 60_000);
    });
  });
  return map;
}

function longestCurrentRun(shifts: Shift[], personId: string): number {
  const dates = [...new Set(shifts.filter((shift) => shift.personId === personId && isWorkActivity(shift.activity)).map((shift) => shift.date))].sort();
  let longest = 0; let run = 0; let previous: Date | null = null;
  for (const dateString of dates) {
    const date = new Date(`${dateString}T12:00:00`);
    run = previous && date.getTime() - previous.getTime() === 86_400_000 ? run + 1 : 1;
    longest = Math.max(longest, run); previous = date;
  }
  return longest;
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [personModal, setPersonModal] = useState(false);
  const [shiftModal, setShiftModal] = useState(false);
  const [aviabitModal, setAviabitModal] = useState(false);
  const [toast, setToast] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData().then(setData).finally(() => setHydrated(true));
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(new URL("sw.js", window.location.href).pathname).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      saveData(data).then(() => setSaveState("saved")).catch(() => setSaveState("error"));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [data, hydrated]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const restMap = useMemo(() => getRestMap(data.shifts), [data.shifts]);
  const alerts = useMemo(() => {
    const result: { id: string; severity: "danger" | "warning"; title: string; detail: string }[] = [];
    data.shifts.forEach((shift) => {
      const rest = restMap.get(shift.id); const person = data.people.find((item) => item.id === shift.personId);
      if (rest !== undefined && rest < 0) result.push({ id: `overlap-${shift.id}`, severity: "danger", title: `${person?.name ?? "Сотрудник"}: смены пересекаются`, detail: `${formatDate(shift.date)} · пересечение ${formatDuration(Math.abs(rest))}` });
      else if (rest !== undefined && rest < 720) result.push({ id: `rest-${shift.id}`, severity: "danger", title: `${person?.name ?? "Сотрудник"}: отдых менее 12 часов`, detail: `${formatDate(shift.date)} · рассчитано ${formatDuration(rest)}` });
    });
    data.people.forEach((person) => {
      const run = longestCurrentRun(data.shifts, person.id);
      if (run >= 7) result.push({ id: `run-${person.id}`, severity: run >= 8 ? "danger" : "warning", title: `${person.name}: ${run} рабочих дней подряд`, detail: "Последовательность требует проверки начальником штаба" });
    });
    data.certifications.forEach((record) => {
      const state = getExpiryState(record); const person = data.people.find((item) => item.id === record.personId);
      if (state.level === "expired") result.push({ id: `cert-${record.id}`, severity: "danger", title: `${person?.name ?? "Сотрудник"}: ${record.certificationType || record.category} просрочено`, detail: `Срок закончился ${formatDate(record.endDate)} · ${state.label.toLocaleLowerCase("ru-RU")}` });
      else if (state.level === "alert14" || state.level === "alert30") result.push({ id: `cert-${record.id}`, severity: state.level === "alert14" ? "danger" : "warning", title: `${person?.name ?? "Сотрудник"}: истекает ${record.certificationType || record.category}`, detail: `${formatDate(record.endDate)} · ${state.label.toLocaleLowerCase("ru-RU")}` });
    });
    return result;
  }, [data, restMap]);
  const sortedShifts = useMemo(() => [...data.shifts].sort((a, b) => `${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`)), [data.shifts]);
  const monthKey = new Date().toISOString().slice(0, 7);
  const monthShifts = data.shifts.filter((shift) => shift.date.startsWith(monthKey));
  const totalWork = monthShifts.reduce((sum, shift) => sum + shift.workMinutes, 0);
  const totalFlight = monthShifts.reduce((sum, shift) => sum + shift.segments.reduce((inner, segment) => inner + segment.flightMinutes, 0), 0);

  function addPerson(person: Omit<Person, "id" | "active">) {
    setData((current) => ({ ...current, people: [...current.people, { ...person, id: uid(), active: true }] }));
    setPersonModal(false); setToast("Сотрудник добавлен");
  }
  function addShift(shift: Omit<Shift, "id" | "createdAt">) {
    setData((current) => ({ ...current, shifts: [...current.shifts, { ...shift, id: uid(), createdAt: new Date().toISOString() }] }));
    setShiftModal(false); setToast("Смена сохранена и проверена");
  }
  function importAviabit(payload: ImportPayload) {
    setData((current) => {
      const personId = payload.targetPersonId ?? uid();
      const aircraftTypes = [...new Set(payload.records.map((record) => record.aircraftType).filter(Boolean))];
      const people = payload.targetPersonId ? current.people : [...current.people, { id: personId, name: payload.personName, position: "Командир воздушного судна", aircraftTypes, active: true }];
      const kept = current.certifications.filter((record) => !(record.personId === personId && record.source === "aviabit"));
      return { ...current, people, certifications: [...kept, ...payload.records.map((record) => ({ ...record, personId }))] };
    });
    setAviabitModal(false); setView("personal"); setToast(`Импортировано записей: ${payload.records.length}`);
  }
  function upsertCertification(record: CertificationRecord) {
    setData((current) => ({ ...current, certifications: current.certifications.some((item) => item.id === record.id) ? current.certifications.map((item) => item.id === record.id ? record : item) : [...current.certifications, record] })); setToast("Запись личного дела сохранена");
  }
  function deleteCertification(recordId: string) { setData((current) => ({ ...current, certifications: current.certifications.filter((record) => record.id !== recordId) })); setToast("Запись удалена"); }
  function exportBackup() {
    download(`shtab-ls-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), data }, null, 2));
    setToast("Резервная копия сохранена");
  }
  function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    file.text().then((text) => {
      const parsed = JSON.parse(text) as { data?: AppData } | AppData;
      const restored = "data" in parsed && parsed.data ? parsed.data : parsed as AppData;
      if (!Array.isArray(restored.people) || !Array.isArray(restored.shifts)) throw new Error("Invalid backup");
      setData({ people: restored.people, shifts: restored.shifts, certifications: restored.certifications ?? [] }); setToast("Резервная копия восстановлена");
    }).catch(() => setToast("Не удалось прочитать резервную копию"));
    event.target.value = "";
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">ЛС</div><div><strong>Штаб ЛС</strong><span>Рабочий контур</span></div></div>
      <nav className="main-nav" aria-label="Основная навигация">
        <NavButton active={view === "dashboard"} onClick={() => setView("dashboard")} label="Главная" glyph="⌂" />
        <NavButton active={view === "shifts"} onClick={() => setView("shifts")} label="Полётные смены" glyph="◷" />
        <NavButton active={view === "people"} onClick={() => setView("people")} label="Личный состав" glyph="◎" />
        <NavButton active={view === "personal"} onClick={() => setView("personal")} label="Личные дела" glyph="▤" />
      </nav>
      <div className="local-card"><span className="status-dot" /><div><strong>Локальная база</strong><span>Данные только на этом устройстве</span></div></div>
      <div className="sidebar-actions"><button className="text-button" onClick={exportBackup}>Скачать резервную копию</button><button className="text-button" onClick={() => importRef.current?.click()}>Восстановить из файла</button><input ref={importRef} hidden type="file" accept="application/json,.json" onChange={importBackup} /></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div><p className="eyebrow">{new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}</p><h1>{view === "dashboard" ? "Оперативная картина" : view === "shifts" ? "Полётные смены" : view === "people" ? "Личный состав" : "Личные дела"}</h1></div>
        <div className="top-actions"><span className={`save-state ${saveState}`}>{saveState === "saved" ? "Сохранено" : saveState === "saving" ? "Сохраняю…" : "Ошибка сохранения"}</span><button className="secondary-button" onClick={() => setPersonModal(true)}>+ Сотрудник</button><button className="primary-button" onClick={() => setShiftModal(true)} disabled={!data.people.length}>+ Добавить смену</button></div>
      </header>
      {!hydrated ? <Loading /> : view === "dashboard" ? <Dashboard people={data.people} shifts={sortedShifts} alerts={alerts} totalWork={totalWork} totalFlight={totalFlight} restMap={restMap} onAddPerson={() => setPersonModal(true)} onAddShift={() => setShiftModal(true)} /> : view === "shifts" ? <ShiftsView people={data.people} shifts={sortedShifts} restMap={restMap} onAdd={() => setShiftModal(true)} /> : view === "people" ? <PeopleView people={data.people} shifts={data.shifts} onAdd={() => setPersonModal(true)} onOpenPersonal={() => setView("personal")} /> : <PersonalFilesView people={data.people} records={data.certifications} onImportClick={() => setAviabitModal(true)} onUpsert={upsertCertification} onDelete={deleteCertification} />}
    </main>
    {personModal && <PersonModal onClose={() => setPersonModal(false)} onSubmit={addPerson} />}
    {shiftModal && <ShiftModal people={data.people} onClose={() => setShiftModal(false)} onSubmit={addShift} />}
    {aviabitModal && <ImportAviabitModal people={data.people} onClose={() => setAviabitModal(false)} onSubmit={importAviabit} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}

function NavButton({ active, onClick, label, glyph }: { active: boolean; onClick: () => void; label: string; glyph: string }) { return <button className={active ? "active" : ""} onClick={onClick}><span>{glyph}</span>{label}</button>; }
function Loading() { return <div className="loading"><span /><p>Открываю локальную базу…</p></div>; }

function Dashboard({ people, shifts, alerts, totalWork, totalFlight, restMap, onAddPerson, onAddShift }: { people: Person[]; shifts: Shift[]; alerts: { id: string; severity: "danger" | "warning"; title: string; detail: string }[]; totalWork: number; totalFlight: number; restMap: Map<string, number>; onAddPerson: () => void; onAddShift: () => void }) {
  if (!people.length) return <section className="empty-start"><div className="empty-visual"><span>01</span><i /></div><p className="eyebrow">Начало работы</p><h2>Создайте первую карточку сотрудника</h2><p>После этого можно вносить смены, а система начнёт автоматически считать рабочее время и отдых.</p><button className="primary-button" onClick={onAddPerson}>Добавить сотрудника</button></section>;
  return <><section className="metric-grid"><Metric label="Активный состав" value={String(people.filter((person) => person.active).length)} detail="сотрудников в базе" tone="blue" /><Metric label="Рабочее время" value={formatDuration(totalWork)} detail="в текущем месяце" tone="navy" /><Metric label="Полётное время" value={formatDuration(totalFlight)} detail="в текущем месяце" tone="teal" /><Metric label="Требует внимания" value={String(alerts.length)} detail={alerts.length ? "открытых предупреждений" : "нарушений не выявлено"} tone={alerts.length ? "red" : "green"} /></section>
    <section className="content-grid"><article className="panel alerts-panel"><div className="panel-heading"><div><p className="eyebrow">Контроль</p><h2>Требует внимания</h2></div><span className="count-badge">{alerts.length}</span></div>{!alerts.length ? <div className="good-state"><span>✓</span><div><strong>Критических замечаний нет</strong><p>Новые предупреждения появятся после расчёта смен.</p></div></div> : alerts.slice(0, 5).map((alert) => <div className={`alert-row ${alert.severity}`} key={alert.id}><span className="alert-icon">!</span><div><strong>{alert.title}</strong><p>{alert.detail}</p></div></div>)}</article>
      <article className="panel recent-panel"><div className="panel-heading"><div><p className="eyebrow">Последние записи</p><h2>Недавние смены</h2></div><button className="link-button" onClick={onAddShift}>Добавить</button></div>{!shifts.length ? <div className="panel-empty">Смен пока нет</div> : shifts.slice(0, 5).map((shift) => { const person = people.find((item) => item.id === shift.personId); const rest = restMap.get(shift.id); return <div className="shift-row" key={shift.id}><div className="date-tile"><strong>{shift.date.slice(8, 10)}</strong><span>{new Intl.DateTimeFormat("ru-RU", { month: "short" }).format(new Date(`${shift.date}T12:00:00`)).replace(".", "")}</span></div><div className="shift-main"><strong>{person?.name ?? "Сотрудник"}</strong><span>{activityLabels[shift.activity]} · {shift.start || "без времени"}</span></div><div className="shift-meta"><strong>{formatDuration(shift.workMinutes)}</strong><span>{rest === undefined ? "первая смена" : `отдых ${formatDuration(rest)}`}</span></div></div>; })}</article></section></>;
}
function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) { return <article className={`metric ${tone}`}><p>{label}</p><strong>{value}</strong><span>{detail}</span></article>; }

function ShiftsView({ people, shifts, restMap, onAdd }: { people: Person[]; shifts: Shift[]; restMap: Map<string, number>; onAdd: () => void }) {
  return <section className="panel table-panel"><div className="panel-heading"><div><p className="eyebrow">Единый журнал</p><h2>Все записи</h2></div><button className="primary-button" disabled={!people.length} onClick={onAdd}>+ Новая смена</button></div>{!shifts.length ? <div className="panel-empty tall">Добавьте первую смену — она появится здесь.</div> : <div className="table-scroll"><table><thead><tr><th>Дата</th><th>Сотрудник</th><th>Занятость</th><th>Начало–конец</th><th>Рабочее</th><th>Полётное</th><th>Отдых</th><th>Статус</th></tr></thead><tbody>{shifts.map((shift) => { const rest = restMap.get(shift.id); const flight = shift.segments.reduce((sum, item) => sum + item.flightMinutes, 0); return <tr key={shift.id}><td>{formatDate(shift.date)}</td><td><strong>{people.find((item) => item.id === shift.personId)?.name ?? "—"}</strong></td><td>{activityLabels[shift.activity]}</td><td>{shift.start || "—"}–{formatClock(shiftEnd(shift))}</td><td>{formatDuration(shift.workMinutes)}</td><td>{flight ? formatDuration(flight) : "—"}</td><td><span className={rest !== undefined && rest < 720 ? "danger-text" : rest !== undefined && rest >= 2520 ? "success-text" : ""}>{rest === undefined ? "—" : formatDuration(rest)}</span></td><td><span className={`status-pill ${shift.status}`}>{shift.status === "planned" ? "План" : shift.status === "actual" ? "Факт" : "Подтверждено"}</span></td></tr>; })}</tbody></table></div>}</section>;
}

function PeopleView({ people, shifts, onAdd, onOpenPersonal }: { people: Person[]; shifts: Shift[]; onAdd: () => void; onOpenPersonal: () => void }) {
  return <section className="panel people-panel"><div className="panel-heading"><div><p className="eyebrow">Реестр</p><h2>Сотрудники</h2></div><button className="primary-button" onClick={onAdd}>+ Добавить</button></div>{!people.length ? <div className="panel-empty tall">Карточки сотрудников ещё не созданы.</div> : <div className="people-grid">{people.map((person) => { const personShifts = shifts.filter((shift) => shift.personId === person.id); return <article className="person-card clickable" key={person.id} onClick={onOpenPersonal}><div className="person-avatar">{person.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</div><div className="person-body"><strong>{person.name}</strong><span>{person.position}</span><div className="tag-row">{person.aircraftTypes.length ? person.aircraftTypes.map((type) => <i key={type}>{type}</i>) : <i>Типы ВС не указаны</i>}</div></div><div className="person-stat"><strong>{personShifts.length}</strong><span>смен</span></div></article>; })}</div>}</section>;
}

function PersonModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (person: Omit<Person, "id" | "active">) => void }) {
  const [name, setName] = useState(""); const [position, setPosition] = useState("Командир воздушного судна"); const [types, setTypes] = useState("");
  function submit(event: FormEvent) { event.preventDefault(); if (!name.trim()) return; onSubmit({ name: name.trim(), position, aircraftTypes: types.split(",").map((item) => item.trim()).filter(Boolean) }); }
  return <Modal title="Новый сотрудник" subtitle="Создание карточки лётного состава" onClose={onClose}><form onSubmit={submit} className="form-stack"><Field label="Ф. И. О."><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="Пронин Алексей Константинович" /></Field><Field label="Должность"><input required value={position} onChange={(event) => setPosition(event.target.value)} /></Field><Field label="Типы ВС" hint="Перечислите через запятую"><input value={types} onChange={(event) => setTypes(event.target.value)} placeholder="R44, R66, BO-105" /></Field><FormActions onClose={onClose} submitLabel="Добавить сотрудника" /></form></Modal>;
}

function ShiftModal({ people, onClose, onSubmit }: { people: Person[]; onClose: () => void; onSubmit: (shift: Omit<Shift, "id" | "createdAt">) => void }) {
  const [personId, setPersonId] = useState(people[0]?.id ?? ""); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [activity, setActivity] = useState<Activity>("flight"); const [start, setStart] = useState("08:00"); const [work, setWork] = useState("08:00"); const [status, setStatus] = useState<Shift["status"]>("actual"); const [note, setNote] = useState("");
  const [segments, setSegments] = useState([{ id: uid(), aircraft: "", purpose: "АОН", flight: "00:00", night: "00:00" }]);
  function submit(event: FormEvent) { event.preventDefault(); if (!personId) return; onSubmit({ personId, date, activity, start: isWorkActivity(activity) ? start : "", workMinutes: isWorkActivity(activity) ? parseDuration(work) : 0, status, segments: activity === "flight" ? segments.map((item) => ({ id: item.id, aircraft: item.aircraft.trim(), purpose: item.purpose.trim(), flightMinutes: parseDuration(item.flight), nightMinutes: parseDuration(item.night) })) : [], note }); }
  return <Modal title="Новая смена" subtitle="Плановые или фактические данные" onClose={onClose} wide><form onSubmit={submit} className="form-stack"><div className="form-grid three"><Field label="Сотрудник"><select value={personId} onChange={(event) => setPersonId(event.target.value)}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field><Field label="Дата"><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label="Статус"><select value={status} onChange={(event) => setStatus(event.target.value as Shift["status"])}><option value="planned">План</option><option value="actual">Факт</option><option value="confirmed">Подтверждено</option></select></Field></div>
    <Field label="Вид занятости"><div className="activity-grid">{Object.entries(activityLabels).map(([key, label]) => <button type="button" key={key} className={activity === key ? "selected" : ""} onClick={() => setActivity(key as Activity)}>{label}</button>)}</div></Field>
    {isWorkActivity(activity) && <div className="form-grid two"><Field label="Начало"><input type="time" required value={start} onChange={(event) => setStart(event.target.value)} /></Field><Field label="Рабочее время" hint="Формат ЧЧ:ММ"><input type="text" inputMode="numeric" pattern="[0-9]{1,3}:[0-5][0-9]" required value={work} onChange={(event) => setWork(event.target.value)} /></Field></div>}
    {activity === "flight" && <div className="segments"><div className="section-label"><strong>Полёты внутри смены</strong><button type="button" className="link-button" onClick={() => setSegments((current) => [...current, { id: uid(), aircraft: "", purpose: "АОН", flight: "00:00", night: "00:00" }])}>+ Добавить полёт</button></div>{segments.map((segment, index) => <div className="segment-row" key={segment.id}><span className="segment-number">{index + 1}</span><Field label="Бортовой №"><input value={segment.aircraft} onChange={(event) => setSegments((current) => current.map((item) => item.id === segment.id ? { ...item, aircraft: event.target.value } : item))} placeholder="RA-00000" /></Field><Field label="Цель"><input value={segment.purpose} onChange={(event) => setSegments((current) => current.map((item) => item.id === segment.id ? { ...item, purpose: event.target.value } : item))} /></Field><Field label="Полётное"><input type="text" inputMode="numeric" pattern="[0-9]{1,3}:[0-5][0-9]" value={segment.flight} onChange={(event) => setSegments((current) => current.map((item) => item.id === segment.id ? { ...item, flight: event.target.value } : item))} /></Field><Field label="Ночь"><input type="text" inputMode="numeric" pattern="[0-9]{1,3}:[0-5][0-9]" value={segment.night} onChange={(event) => setSegments((current) => current.map((item) => item.id === segment.id ? { ...item, night: event.target.value } : item))} /></Field>{segments.length > 1 && <button type="button" className="remove-segment" aria-label="Удалить полёт" onClick={() => setSegments((current) => current.filter((item) => item.id !== segment.id))}>×</button>}</div>)}</div>}
    <Field label="Примечание"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Проверка, тренаж, особые обстоятельства…" /></Field><FormActions onClose={onClose} submitLabel="Сохранить смену" /></form></Modal>;
}

function Modal({ title, subtitle, onClose, wide, children }: { title: string; subtitle: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) { return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><div><p className="eyebrow">Штаб ЛС</p><h2 id="modal-title">{title}</h2><span>{subtitle}</span></div><button className="modal-close" aria-label="Закрыть" onClick={onClose}>×</button></header>{children}</section></div>; }
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="field"><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>; }
function FormActions({ onClose, submitLabel }: { onClose: () => void; submitLabel: string }) { return <div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button">{submitLabel}</button></div>; }
