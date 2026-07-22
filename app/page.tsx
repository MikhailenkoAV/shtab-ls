"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { downloadEmploymentReport, downloadFlightReport } from "./monthly-report";
import { CertificationRecord, getExpiryState, ImportAviabitModal, ImportPayload, PersonalFilesView } from "./personal-files";

type View = "dashboard" | "shifts" | "people" | "personal";
type Activity = "flight" | "trip" | "office" | "periodic_training" | "ground_training" | "standby" | "vacation" | "dayoff";
type Seat = "КВС" | "Пилот-инструктор";

type Qualification = { id: string; operators: string[]; aircraftTypes: string[]; seats: string[] };
type Person = { id: string; name: string; position: string; permissions: string[]; aircraftTypes: string[]; qualifications: Qualification[]; active: boolean };
type Segment = { id: string; aircraft: string; aircraftType?: string; seat: Seat; purpose: string; flightMinutes: number; nightMinutes: number };
type Shift = {
  id: string; personId: string; date: string; activity: Activity; start: string; workMinutes: number;
  segments: Segment[]; note: string; createdAt: string;
  periodId?: string; periodStart?: string; periodEnd?: string;
};
type ShiftDraft = Omit<Shift, "id" | "createdAt" | "periodId" | "periodStart" | "periodEnd"> & { dateTo?: string };
type AppData = { people: Person[]; shifts: Shift[]; certifications: CertificationRecord[] };

const EMPTY_DATA: AppData = { people: [], shifts: [], certifications: [] };
const DB_NAME = "shtab-ls";
const STORE_NAME = "workspace";
const STATE_KEY = "primary";
const activityLabels: Record<Activity, string> = {
  flight: "Полётная смена",
  trip: "Командировка",
  office: "Работа в офисе",
  periodic_training: "Периодическая подготовка",
  ground_training: "Наземная подготовка",
  standby: "Ожидание полёта",
  vacation: "Отпуск",
  dayoff: "Выходной",
};
const multiDayActivities: Activity[] = ["trip", "vacation", "periodic_training"];
const flightPurposes = ["КВП", "АОН", "АР", "АОН (УТП)"];
const seatOptions: Seat[] = ["КВС", "Пилот-инструктор"];
const positionOptions = ["Командир ВС", "Пилот-инструктор", "Экзаменатор"];
const operatorOptions = ["КВП", "АОН", "АР"];
const aircraftTypeOptions = ["A109", "AW109", "AW139", "AS350", "EC130", "R44", "R66", "BO105"];
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function normalizeActivity(value: string): Activity {
  if (value === "duty") return "standby";
  if (value === "training") return "periodic_training";
  return value in activityLabels ? value as Activity : "office";
}

function normalizeShift(shift: Shift): Shift {
  const normalized: Shift = {
    ...shift,
    activity: normalizeActivity(shift.activity),
    segments: (shift.segments ?? []).map((segment) => ({ ...segment, seat: segment.seat ?? "КВС" })),
  };
  delete (normalized as Shift & { status?: unknown }).status;
  return normalized;
}

function parseStoredPositions(value: string): { selected: string[]; other: string } {
  const selected = new Set<string>();
  const other: string[] = [];
  value.split(",").map((item) => item.trim()).filter(Boolean).forEach((item) => {
    const normalized = item.toLocaleLowerCase("ru-RU");
    if (normalized === "квс" || normalized.includes("командир воздушного") || normalized === "командир вс") selected.add("Командир ВС");
    else if (normalized.includes("инструктор")) selected.add("Пилот-инструктор");
    else if (normalized.includes("экзаменатор")) selected.add("Экзаменатор");
    else other.push(item);
  });
  return { selected: [...selected], other: other.join(", ") };
}

function orderedUnique(values: string[], preferredOrder: string[]): string[] {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return [...preferredOrder.filter((value) => unique.includes(value)), ...unique.filter((value) => !preferredOrder.includes(value))];
}

function normalizePerson(person: Person): Person {
  const legacySeats = parseStoredPositions(person.position ?? "").selected;
  const qualifications = person.qualifications?.length ? person.qualifications.map((qualification, index) => ({
    id: qualification.id || `${person.id}-qualification-${index + 1}`,
    operators: orderedUnique(qualification.operators ?? [], operatorOptions),
    aircraftTypes: orderedUnique(qualification.aircraftTypes ?? [], aircraftTypeOptions),
    seats: orderedUnique(qualification.seats ?? [], positionOptions),
  })) : ((person.permissions?.length || person.aircraftTypes?.length || legacySeats.length) ? [{
    id: `${person.id}-legacy-qualification`,
    operators: orderedUnique(person.permissions ?? [], operatorOptions),
    aircraftTypes: orderedUnique(person.aircraftTypes ?? [], aircraftTypeOptions),
    seats: orderedUnique(legacySeats, positionOptions),
  }] : []);
  const operators = orderedUnique(qualifications.flatMap((qualification) => qualification.operators), operatorOptions);
  const aircraftTypes = orderedUnique(qualifications.flatMap((qualification) => qualification.aircraftTypes), aircraftTypeOptions);
  const seats = orderedUnique(qualifications.flatMap((qualification) => qualification.seats), positionOptions);
  return { ...person, position: seats.join(", "), permissions: operators, aircraftTypes, qualifications };
}

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
    request.onsuccess = () => { const stored = request.result as Partial<AppData> | undefined; resolve({ people: (stored?.people ?? []).map(normalizePerson), shifts: (stored?.shifts ?? []).map(normalizeShift), certifications: stored?.certifications ?? [] }); };
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
function compactTime(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 5);
  return digits.length <= 2 ? digits : `${digits.slice(0, -2)}:${digits.slice(-2)}`;
}
function normalizeTime(value: string, clock = false): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const hours = digits.length <= 2 ? digits : digits.slice(0, -2);
  const minutes = digits.length <= 2 ? "00" : digits.slice(-2);
  const hoursNumber = Number(hours); const minutesNumber = Number(minutes);
  if (!Number.isFinite(hoursNumber) || minutesNumber > 59 || (clock && hoursNumber > 23)) return "";
  return `${String(hoursNumber).padStart(2, "0")}:${String(minutesNumber).padStart(2, "0")}`;
}
function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes)) return "—";
  const sign = minutes < 0 ? "−" : "";
  const absolute = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(absolute / 60)} ч ${String(absolute % 60).padStart(2, "0")} мин`;
}
function durationValue(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
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
function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function enumerateDates(dateFrom: string, dateTo: string): string[] {
  const result: string[] = [];
  const current = new Date(`${dateFrom}T12:00:00`);
  const end = new Date(`${dateTo}T12:00:00`);
  while (current <= end) {
    result.push(localIsoDate(current));
    current.setDate(current.getDate() + 1);
  }
  return result;
}
function shiftEndClock(shift: Shift): string {
  if (!shift.start) return "—";
  const [hours = "0", minutes = "0"] = shift.start.split(":");
  const total = Number(hours) * 60 + Number(minutes) + shift.workMinutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function isWorkActivity(activity: Activity): boolean { return !["vacation", "dayoff"].includes(activity); }
function usesTime(activity: Activity): boolean { return !["trip", "vacation", "dayoff"].includes(activity); }

function getRestMap(shifts: Shift[]): Map<string, number> {
  const map = new Map<string, number>();
  const groups = new Map<string, Map<string, Shift[]>>();
  shifts.filter((shift) => isWorkActivity(shift.activity) && shiftStart(shift)).forEach((shift) => {
    const personDays = groups.get(shift.personId) ?? new Map<string, Shift[]>();
    personDays.set(shift.date, [...(personDays.get(shift.date) ?? []), shift]);
    groups.set(shift.personId, personDays);
  });
  groups.forEach((personDays) => {
    const days = [...personDays.entries()].map(([date, items]) => ({
      date,
      items,
      start: Math.min(...items.map((shift) => shiftStart(shift)?.getTime() ?? Number.POSITIVE_INFINITY)),
      end: Math.max(...items.map((shift) => shiftEnd(shift)?.getTime() ?? Number.NEGATIVE_INFINITY)),
    })).sort((a, b) => a.start - b.start);
    days.forEach((day, index) => {
      if (!index) return;
      const rest = (day.start - days[index - 1].end) / 60_000;
      day.items.forEach((shift) => map.set(shift.id, rest));
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
  const [personModal, setPersonModal] = useState<Person | "new" | null>(null);
  const [shiftModal, setShiftModal] = useState<Shift | "new" | null>(null);
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
  const monthKey = new Date().toISOString().slice(0, 7);
  const monthShifts = useMemo(() => data.shifts.filter((shift) => shift.date.startsWith(monthKey)), [data.shifts, monthKey]);
  const alerts = useMemo(() => {
    const result: { id: string; severity: "danger" | "warning"; title: string; detail: string }[] = [];
    const dailyRestAlerts = new Set<string>();
    monthShifts.forEach((shift) => {
      const rest = restMap.get(shift.id); const person = data.people.find((item) => item.id === shift.personId);
      const dayKey = `${shift.personId}-${shift.date}`;
      if (rest !== undefined && rest >= 0 && rest < 720 && !dailyRestAlerts.has(dayKey)) { dailyRestAlerts.add(dayKey); result.push({ id: `rest-${dayKey}`, severity: "danger", title: `${person?.name ?? "Сотрудник"}: отдых менее 12 часов`, detail: `${formatDate(shift.date)} · рассчитано ${formatDuration(rest)}` }); }
    });
    data.people.forEach((person) => {
      const run = longestCurrentRun(monthShifts, person.id);
      if (run >= 7) result.push({ id: `run-${person.id}`, severity: run >= 8 ? "danger" : "warning", title: `${person.name}: ${run} рабочих дней подряд`, detail: "Последовательность требует проверки начальником штаба" });
    });
    data.certifications.forEach((record) => {
      const state = getExpiryState(record); const person = data.people.find((item) => item.id === record.personId);
      if (state.level === "expired") result.push({ id: `cert-${record.id}`, severity: "danger", title: `${person?.name ?? "Сотрудник"}: ${record.certificationType || record.category} просрочено`, detail: `Срок закончился ${formatDate(record.endDate)} · ${state.label.toLocaleLowerCase("ru-RU")}` });
      else if (state.level === "alert14" || state.level === "alert30") result.push({ id: `cert-${record.id}`, severity: state.level === "alert14" ? "danger" : "warning", title: `${person?.name ?? "Сотрудник"}: истекает ${record.certificationType || record.category}`, detail: `${formatDate(record.endDate)} · ${state.label.toLocaleLowerCase("ru-RU")}` });
    });
    return result;
  }, [data, restMap, monthShifts]);
  const sortedShifts = useMemo(() => [...data.shifts].sort((a, b) => `${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`)), [data.shifts]);
  const monthSortedShifts = useMemo(() => [...monthShifts].sort((a, b) => `${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`)), [monthShifts]);
  const totalWork = monthShifts.reduce((sum, shift) => sum + shift.workMinutes, 0);
  const totalFlight = monthShifts.reduce((sum, shift) => sum + shift.segments.reduce((inner, segment) => inner + segment.flightMinutes, 0), 0);

  function savePerson(person: Omit<Person, "id" | "active">) {
    if (personModal && personModal !== "new") setData((current) => ({ ...current, people: current.people.map((item) => item.id === personModal.id ? { ...item, ...person } : item) }));
    else setData((current) => ({ ...current, people: [...current.people, { ...person, id: uid(), active: true }] }));
    setPersonModal(null); setToast(personModal === "new" ? "Сотрудник добавлен" : "Данные сотрудника обновлены");
  }
  function deletePerson(person: Person) {
    const related = data.shifts.filter((shift) => shift.personId === person.id).length + data.certifications.filter((record) => record.personId === person.id).length;
    if (!window.confirm(related ? `Удалить ${person.name} вместе со связанными записями (${related})?` : `Удалить ${person.name} из состава?`)) return;
    setData((current) => ({ ...current, people: current.people.filter((item) => item.id !== person.id), shifts: current.shifts.filter((shift) => shift.personId !== person.id), certifications: current.certifications.filter((record) => record.personId !== person.id) }));
    setPersonModal(null); setToast("Сотрудник удалён");
  }
  function saveShift(shift: ShiftDraft) {
    const editing = shiftModal && shiftModal !== "new" ? shiftModal : null;
    const { dateTo, ...base } = shift;
    const hasPeriod = multiDayActivities.includes(shift.activity) && Boolean(dateTo && dateTo > shift.date);
    const dates = hasPeriod ? enumerateDates(shift.date, dateTo!) : [shift.date];
    const periodId = hasPeriod ? editing?.periodId ?? uid() : undefined;
    const createdAt = editing?.createdAt ?? new Date().toISOString();
    const records: Shift[] = dates.map((date) => ({
      ...base,
      id: dates.length === 1 && editing ? editing.id : uid(),
      date,
      createdAt,
      periodId,
      periodStart: periodId ? dates[0] : undefined,
      periodEnd: periodId ? dates.at(-1) : undefined,
    }));
    setData((current) => {
      const kept = editing ? current.shifts.filter((item) => editing.periodId ? item.periodId !== editing.periodId : item.id !== editing.id) : current.shifts;
      return { ...current, shifts: [...kept, ...records] };
    });
    setShiftModal(null); setToast(hasPeriod ? `Период сохранён: ${dates.length} дн.` : "Запись сохранена");
  }
  function deleteShift(shift: Shift) {
    const periodText = shift.periodId && shift.periodStart && shift.periodEnd ? ` весь период ${formatDate(shift.periodStart)} — ${formatDate(shift.periodEnd)}` : ` запись ${formatDate(shift.date)}`;
    if (!window.confirm(`Удалить${periodText}?`)) return;
    setData((current) => ({ ...current, shifts: current.shifts.filter((item) => shift.periodId ? item.periodId !== shift.periodId : item.id !== shift.id) })); setShiftModal(null); setToast(shift.periodId ? "Период удалён" : "Запись удалена");
  }
  function importAviabit(payload: ImportPayload) {
    setData((current) => {
      const personId = payload.targetPersonId ?? uid();
      const aircraftTypes = [...new Set(payload.records.map((record) => record.aircraftType).filter(Boolean))];
      const people = payload.targetPersonId ? current.people : [...current.people, {
        id: personId,
        name: payload.personName,
        position: "Командир ВС",
        permissions: [],
        aircraftTypes,
        qualifications: aircraftTypes.length ? [{ id: uid(), operators: [], aircraftTypes, seats: ["Командир ВС"] }] : [],
        active: true,
      }];
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
    download(`shtab-ls-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), data }, null, 2));
    setToast("Резервная копия сохранена");
  }
  function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    file.text().then((text) => {
      const parsed = JSON.parse(text) as { data?: AppData } | AppData;
      const restored = "data" in parsed && parsed.data ? parsed.data : parsed as AppData;
      if (!Array.isArray(restored.people) || !Array.isArray(restored.shifts)) throw new Error("Invalid backup");
      setData({ people: restored.people.map(normalizePerson), shifts: restored.shifts.map(normalizeShift), certifications: restored.certifications ?? [] }); setToast("Резервная копия восстановлена");
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
      <div className="company-logo">
        {/* The public asset must stay relative so it also works under the GitHub Pages repository path. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="solaris-logo.png" alt="Центр авиации «Солярис»" />
      </div>
    </aside>
    <main className="workspace" style={{ backgroundImage: 'linear-gradient(180deg, rgba(242, 245, 246, .64), rgba(242, 245, 246, .83)), url("solaris-airfield-bg.jpg")' }}>
      <header className="topbar"><div><p className="eyebrow">{new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}</p><h1>{view === "dashboard" ? "Оперативная информация" : view === "shifts" ? "Полётные смены" : view === "people" ? "Личный состав" : "Личные дела"}</h1></div>
        <div className="top-actions"><span className={`save-state ${saveState}`}>{saveState === "saved" ? "Сохранено" : saveState === "saving" ? "Сохраняю…" : "Ошибка сохранения"}</span><button className="secondary-button" onClick={() => setPersonModal("new")}>+ Сотрудник</button><button className="primary-button" onClick={() => setShiftModal("new")} disabled={!data.people.length}>+ Добавить смену</button></div>
      </header>
      {!hydrated ? <Loading /> : view === "dashboard" ? <Dashboard people={data.people} shifts={monthSortedShifts} alerts={alerts} totalWork={totalWork} totalFlight={totalFlight} restMap={restMap} onAddPerson={() => setPersonModal("new")} onAddShift={() => setShiftModal("new")} /> : view === "shifts" ? <ShiftsView people={data.people} shifts={sortedShifts} restMap={restMap} onAdd={() => setShiftModal("new")} onEdit={setShiftModal} onDelete={deleteShift} onNotify={setToast} /> : view === "people" ? <PeopleView people={data.people} shifts={data.shifts} onAdd={() => setPersonModal("new")} onEdit={setPersonModal} onOpenPersonal={() => setView("personal")} /> : <PersonalFilesView people={data.people} records={data.certifications} onImportClick={() => setAviabitModal(true)} onUpsert={upsertCertification} onDelete={deleteCertification} />}
    </main>
    {personModal && <PersonModal person={personModal === "new" ? null : personModal} onClose={() => setPersonModal(null)} onSubmit={savePerson} onDelete={personModal === "new" ? undefined : () => deletePerson(personModal)} />}
    {shiftModal && <ShiftModal people={data.people} shift={shiftModal === "new" ? null : shiftModal} onClose={() => setShiftModal(null)} onSubmit={saveShift} onDelete={shiftModal === "new" ? undefined : () => deleteShift(shiftModal)} />}
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

function ShiftsView({ people, shifts, restMap, onAdd, onEdit, onDelete, onNotify }: { people: Person[]; shifts: Shift[]; restMap: Map<string, number>; onAdd: () => void; onEdit: (shift: Shift) => void; onDelete: (shift: Shift) => void; onNotify: (message: string) => void }) {
  const today = new Date();
  const [dateFrom, setDateFrom] = useState(localIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [dateTo, setDateTo] = useState(localIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)));
  const [personId, setPersonId] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const filtered = shifts.filter((shift) => (!dateFrom || shift.date >= dateFrom) && (!dateTo || shift.date <= dateTo) && (!personId || shift.personId === personId));
  function showCurrentMonth() {
    setDateFrom(localIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)));
    setDateTo(localIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)));
  }
  function showToday() {
    const value = localIsoDate(today);
    setDateFrom(value); setDateTo(value);
  }
  return <><section className="panel table-panel"><div className="panel-heading"><div><p className="eyebrow">Единый журнал</p><h2>Смены за выбранный период</h2></div><div className="journal-heading-actions"><button className="secondary-button pdf-button" disabled={!people.length} onClick={() => setReportOpen(true)}>Отчёт PDF</button><button className="primary-button" disabled={!people.length} onClick={onAdd}>+ Новая смена</button></div></div>
    <div className="journal-filters"><Field label="Период с"><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></Field><Field label="Период по"><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></Field><Field label="Сотрудник"><select value={personId} onChange={(event) => setPersonId(event.target.value)}><option value="">Все сотрудники</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field><div className="quick-filters"><button className="secondary-button" onClick={showToday}>Сегодня</button><button className="secondary-button" onClick={showCurrentMonth}>Текущий месяц</button></div></div>
    <div className="journal-summary">Показано записей: <strong>{filtered.length}</strong>{dateFrom === dateTo ? ` · ${formatDate(dateFrom)}` : ` · ${formatDate(dateFrom)} — ${formatDate(dateTo)}`}</div>
    {!filtered.length ? <div className="panel-empty tall">За выбранный период смен нет.</div> : <div className="table-scroll"><table><thead><tr><th>Дата</th><th>Сотрудник</th><th>Занятость</th><th>Начало–конец</th><th>Рабочее</th><th>Полётное</th><th>Отдых</th><th>Примечание</th><th>Действия</th></tr></thead><tbody>{filtered.map((shift) => { const rest = restMap.get(shift.id); const flight = shift.segments.reduce((sum, item) => sum + item.flightMinutes, 0); return <tr key={shift.id}><td>{formatDate(shift.date)}</td><td><strong>{people.find((item) => item.id === shift.personId)?.name ?? "—"}</strong></td><td>{activityLabels[shift.activity]}</td><td>{shift.start || "—"}–{shiftEndClock(shift)}</td><td>{formatDuration(shift.workMinutes)}</td><td>{flight ? formatDuration(flight) : "—"}</td><td><span className={rest !== undefined && rest >= 0 && rest < 720 ? "danger-text" : rest !== undefined && rest >= 2520 ? "success-text" : ""}>{rest === undefined ? "—" : rest < 0 ? "пересечение" : formatDuration(rest)}</span></td><td className="note-cell">{shift.note || "—"}</td><td><div className="row-actions"><button onClick={() => onEdit(shift)}>Изменить</button><button className="delete" onClick={() => onDelete(shift)}>Удалить</button></div></td></tr>; })}</tbody></table></div>}
  </section>{reportOpen && <FlightReportModal people={people} shifts={shifts} onClose={() => setReportOpen(false)} onNotify={onNotify} />}</>;
}

function FlightReportModal({ people, shifts, onClose, onNotify }: { people: Person[]; shifts: Shift[]; onClose: () => void; onNotify: (message: string) => void }) {
  const today = new Date();
  const [reportType, setReportType] = useState<"flight" | "employment">("flight");
  const [dateFrom, setDateFrom] = useState(localIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [dateTo, setDateTo] = useState(localIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)));
  const [personId, setPersonId] = useState("");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dateFrom || !dateTo || dateFrom > dateTo) { setError("Проверьте даты периода отчёта."); return; }
    setExporting(true); setError("");
    try {
      if (reportType === "flight") await downloadFlightReport(dateFrom, dateTo, people, shifts, personId || null);
      else await downloadEmploymentReport(dateFrom, dateTo, people, shifts, personId || null);
      onNotify("PDF-отчёт сформирован"); onClose();
    } catch {
      setError("Не удалось сформировать PDF. Попробуйте ещё раз.");
    } finally {
      setExporting(false);
    }
  }
  return <Modal title="Формирование отчёта" subtitle="Произвольный период и состав отчёта" onClose={onClose}><form className="form-stack" onSubmit={submit}><Field label="Вид отчёта"><select value={reportType} onChange={(event) => setReportType(event.target.value as "flight" | "employment")}><option value="flight">Отчёт о налёте</option><option value="employment">Ежедневная занятость</option></select></Field><div className="form-grid two"><Field label="Период с"><input required type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></Field><Field label="Период по"><input required type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></Field></div><Field label="Состав отчёта"><select value={personId} onChange={(event) => setPersonId(event.target.value)}><option value="">Все сотрудники — общий отчёт</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field><div className="report-scope-note">{reportType === "flight" ? "Отчёт показывает налёт в разрезе кресла, типа ВС и цели полёта; для общего состава добавляется сводная часть." : "Для каждого сотрудника будут показаны все календарные дни периода, вид занятости, рабочее время и примечание."}</div>{error && <div className="form-error">{error}</div>}<div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button" disabled={exporting}>{exporting ? "Формирую…" : "Скачать PDF"}</button></div></form></Modal>;
}

function PeopleView({ people, shifts, onAdd, onEdit, onOpenPersonal }: { people: Person[]; shifts: Shift[]; onAdd: () => void; onEdit: (person: Person) => void; onOpenPersonal: () => void }) {
  return <section className="panel people-panel">
    <div className="panel-heading"><div><p className="eyebrow">Реестр</p><h2>Сотрудники</h2></div><button className="primary-button" onClick={onAdd}>+ Добавить</button></div>
    {!people.length ? <div className="panel-empty tall">Карточки сотрудников ещё не созданы.</div> : <div className="people-grid">{people.map((person) => {
      const personShifts = shifts.filter((shift) => shift.personId === person.id);
      return <article className="person-card" key={person.id}>
        <div className="person-avatar">{person.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</div>
        <div className="person-body">
          <strong>{person.name}</strong>
          <span>{person.position || "Кресла не указаны"}</span>
          <div className="person-qualification-list">{person.qualifications.length ? person.qualifications.map((qualification) => <div key={qualification.id}>
            <b>{qualification.operators.join(", ") || "Эксплуатант не указан"}</b>
            <span>{qualification.aircraftTypes.join(", ") || "Тип ВС не указан"}</span>
            <small>{qualification.seats.join(", ") || "Кресла не указаны"}</small>
          </div>) : <div><span>Наборы допуска не указаны</span></div>}</div>
          <div className="person-card-actions"><button onClick={onOpenPersonal}>Личное дело</button><button onClick={() => onEdit(person)}>Изменить</button></div>
        </div>
        <div className="person-stat"><strong>{personShifts.length}</strong><span>смен</span></div>
      </article>;
    })}</div>}
  </section>;
}

function PersonModal({ person, onClose, onSubmit, onDelete }: { person: Person | null; onClose: () => void; onSubmit: (person: Omit<Person, "id" | "active">) => void; onDelete?: () => void }) {
  const [name, setName] = useState(person?.name ?? "");
  const [qualifications, setQualifications] = useState<Qualification[]>(person?.qualifications ?? []);
  const [operators, setOperators] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [seats, setSeats] = useState<string[]>([]);
  const [editingQualificationId, setEditingQualificationId] = useState<string | null>(null);
  const [error, setError] = useState("");

  function resetQualificationDraft() {
    setOperators([]); setTypes([]); setSeats([]); setEditingQualificationId(null); setError("");
  }

  function saveQualification() {
    if (!operators.length || !types.length || !seats.length) {
      setError("Для набора выберите эксплуатанта, тип ВС и хотя бы одно занимаемое кресло.");
      return;
    }
    const qualification: Qualification = {
      id: editingQualificationId ?? uid(),
      operators: orderedUnique(operators, operatorOptions),
      aircraftTypes: orderedUnique(types, aircraftTypeOptions),
      seats: orderedUnique(seats, positionOptions),
    };
    setQualifications((current) => editingQualificationId
      ? current.map((item) => item.id === editingQualificationId ? qualification : item)
      : [...current, qualification]);
    resetQualificationDraft();
  }

  function editQualification(qualification: Qualification) {
    setOperators(qualification.operators); setTypes(qualification.aircraftTypes); setSeats(qualification.seats);
    setEditingQualificationId(qualification.id); setError("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError("Укажите Ф. И. О. сотрудника."); return; }
    if (operators.length || types.length || seats.length || editingQualificationId) { setError("Сначала добавьте или сохраните заполненный набор допуска."); return; }
    if (!qualifications.length) { setError("Добавьте хотя бы один набор допуска сотрудника."); return; }
    if (qualifications.some((qualification) => !qualification.operators.length || !qualification.aircraftTypes.length || !qualification.seats.length)) {
      setError("Отредактируйте неполный набор: эксплуатант, тип ВС и кресла обязательны."); return;
    }
    const permissions = orderedUnique(qualifications.flatMap((qualification) => qualification.operators), operatorOptions);
    const aircraftTypes = orderedUnique(qualifications.flatMap((qualification) => qualification.aircraftTypes), aircraftTypeOptions);
    const position = orderedUnique(qualifications.flatMap((qualification) => qualification.seats), positionOptions).join(", ");
    onSubmit({ name: name.trim(), position, permissions, aircraftTypes, qualifications });
  }
  return <Modal title={person ? "Редактирование сотрудника" : "Новый сотрудник"} subtitle="Эксплуатант → тип ВС → занимаемые кресла" onClose={onClose} wide>
    <form onSubmit={submit} className="form-stack person-form">
      <Field label="Ф. И. О."><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="Иванов Иван Иванович" /></Field>
      <section className="qualification-builder">
        <div className="qualification-builder-heading"><div><strong>{editingQualificationId ? "Изменение набора допуска" : "Новый набор допуска"}</strong><span>Последовательно выберите данные и добавьте набор в карточку сотрудника.</span></div>{editingQualificationId && <button type="button" className="link-button" onClick={resetQualificationDraft}>Отменить изменение набора</button>}</div>
        <div className="qualification-step"><span>1</span><CheckboxGroup label="Эксплуатант" options={operatorOptions} values={operators} onChange={setOperators} /></div>
        <div className="qualification-step"><span>2</span><CheckboxGroup label="Тип ВС" options={aircraftTypeOptions} values={types} onChange={setTypes} columns={4} /></div>
        <div className="qualification-step"><span>3</span><CheckboxGroup label="Занимаемые кресла" options={positionOptions} values={seats} onChange={setSeats} /></div>
        <div className="qualification-add"><button type="button" className="secondary-button" onClick={saveQualification}>{editingQualificationId ? "Сохранить набор" : "+ Добавить набор"}</button></div>
      </section>
      {qualifications.length > 0 && <section className="qualification-list"><div className="section-label"><strong>Добавленные наборы</strong><span>{qualifications.length}</span></div>{qualifications.map((qualification, index) => <article className={editingQualificationId === qualification.id ? "editing" : ""} key={qualification.id}>
        <div className="qualification-index">{index + 1}</div>
        <div><small>Эксплуатант</small><strong>{qualification.operators.join(", ") || "Не указан"}</strong></div>
        <div><small>Тип ВС</small><strong>{qualification.aircraftTypes.join(", ") || "Не указан"}</strong></div>
        <div><small>Кресла</small><strong>{qualification.seats.join(", ") || "Не указаны"}</strong></div>
        <div className="qualification-actions"><button type="button" onClick={() => editQualification(qualification)}>Изменить</button><button type="button" className="delete" onClick={() => { setQualifications((current) => current.filter((item) => item.id !== qualification.id)); if (editingQualificationId === qualification.id) resetQualificationDraft(); }}>Удалить</button></div>
      </article>)}</section>}
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions split">{onDelete && <button type="button" className="danger-button" onClick={onDelete}>Удалить сотрудника</button>}<span /><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button">{person ? "Подтвердить изменения" : "Добавить сотрудника"}</button></div>
    </form>
  </Modal>;
}

function ShiftModal({ people, shift, onClose, onSubmit, onDelete }: { people: Person[]; shift: Shift | null; onClose: () => void; onSubmit: (shift: ShiftDraft) => void; onDelete?: () => void }) {
  const initialDate = shift?.periodStart ?? shift?.date ?? localIsoDate(new Date());
  const [personId, setPersonId] = useState(shift?.personId ?? people[0]?.id ?? "");
  const [date, setDate] = useState(initialDate);
  const [dateTo, setDateTo] = useState(shift?.periodEnd ?? initialDate);
  const [activity, setActivity] = useState<Activity>(shift?.activity ?? "flight");
  const [start, setStart] = useState(shift?.start ?? "08:00");
  const [work, setWork] = useState(shift ? durationValue(shift.workMinutes) : "08:00");
  const [note, setNote] = useState(shift?.note ?? "");
  const [error, setError] = useState("");
  const selectedAircraftTypes = people.find((person) => person.id === personId)?.aircraftTypes ?? [];
  const defaultAircraftType = selectedAircraftTypes.length === 1 ? selectedAircraftTypes[0] : "";
  const [segments, setSegments] = useState(shift?.segments.length ? shift.segments.map((item) => ({
    id: item.id,
    aircraft: item.aircraft,
    aircraftType: item.aircraftType ?? defaultAircraftType,
    seat: item.seat ?? "КВС" as Seat,
    purpose: item.purpose || "АОН",
    flight: durationValue(item.flightMinutes),
    night: durationValue(item.nightMinutes),
  })) : [{ id: uid(), aircraft: "", aircraftType: defaultAircraftType, seat: "КВС" as Seat, purpose: "АОН", flight: "00:00", night: "00:00" }]);
  const supportsPeriod = multiDayActivities.includes(activity);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!personId) return;
    if (supportsPeriod && (!dateTo || dateTo < date)) { setError("Дата окончания периода не может быть раньше даты начала."); return; }
    const safeStart = usesTime(activity) ? normalizeTime(start, true) : "";
    const safeWork = usesTime(activity) ? normalizeTime(work) : "";
    if (usesTime(activity) && (!safeStart || !safeWork)) { setError("Проверьте время: минуты должны быть от 00 до 59."); return; }
    if (activity === "flight" && segments.some((item) => (item.flight && !normalizeTime(item.flight)) || (item.night && !normalizeTime(item.night)))) { setError("Проверьте полётное и ночное время."); return; }
    const safeSegments = segments.map((item) => ({ ...item, flight: normalizeTime(item.flight) || "00:00", night: normalizeTime(item.night) || "00:00" }));
    onSubmit({
      personId,
      date,
      dateTo: supportsPeriod ? dateTo : date,
      activity,
      start: safeStart,
      workMinutes: safeWork ? parseDuration(safeWork) : 0,
      segments: activity === "flight" ? safeSegments.map((item) => ({
        id: item.id,
        aircraft: item.aircraft.trim(),
        aircraftType: item.aircraftType.trim(),
        seat: item.seat,
        purpose: item.purpose,
        flightMinutes: parseDuration(item.flight),
        nightMinutes: parseDuration(item.night),
      })) : [],
      note,
    });
  }

  return <Modal title={shift ? "Редактирование записи" : "Новая запись"} subtitle={shift?.periodId ? "Изменения применятся ко всему связанному периоду" : "Данные о выполненной занятости"} onClose={onClose} wide>
    <form onSubmit={submit} className="form-stack">
      <Field label="Сотрудник"><select value={personId} onChange={(event) => setPersonId(event.target.value)}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
      <Field label="Вид занятости"><div className="activity-grid">{Object.entries(activityLabels).map(([key, label]) => <button type="button" key={key} className={activity === key ? "selected" : ""} onClick={() => { setActivity(key as Activity); setError(""); }}>{label}</button>)}</div></Field>
      {supportsPeriod ? <div className="form-grid two"><Field label="Период с"><input required type="date" value={date} onChange={(event) => { setDate(event.target.value); if (dateTo < event.target.value) setDateTo(event.target.value); }} /></Field><Field label="Период по" hint="Каждый календарный день"><input required type="date" min={date} value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></Field></div> : <Field label="Дата"><input required type="date" value={date} onChange={(event) => { setDate(event.target.value); setDateTo(event.target.value); }} /></Field>}
      {usesTime(activity) && <div className="form-grid two"><Field label="Начало" hint="Например, 0830 → 08:30"><TimeEntry required clock value={start} onChange={setStart} /></Field><Field label="Рабочее время" hint="Например, 800 → 08:00"><TimeEntry required value={work} onChange={setWork} /></Field></div>}
      {activity === "flight" && <div className="segments"><datalist id="shift-aircraft-types">{selectedAircraftTypes.map((type) => <option key={type} value={type} />)}</datalist><div className="section-label"><strong>Полёты внутри смены</strong><button type="button" className="link-button" onClick={() => setSegments((current) => [...current, { id: uid(), aircraft: "", aircraftType: defaultAircraftType, seat: "КВС", purpose: "АОН", flight: "00:00", night: "00:00" }])}>+ Добавить полёт</button></div>{segments.map((segment, index) => <div className="segment-row" key={segment.id}>
        <span className="segment-number">{index + 1}</span>
        <Field label="Кресло"><select value={segment.seat} onChange={(event) => setSegments((current) => current.map((item) => item.id === segment.id ? { ...item, seat: event.target.value as Seat } : item))}>{seatOptions.map((seat) => <option key={seat}>{seat}</option>)}</select></Field>
        <Field label="Тип ВС"><input required list="shift-aircraft-types" value={segment.aircraftType} onChange={(event) => setSegments((current) => current.map((item) => item.id === segment.id ? { ...item, aircraftType: event.target.value } : item))} placeholder="Ми-8" /></Field>
        <Field label="Бортовой №"><input value={segment.aircraft} onChange={(event) => setSegments((current) => current.map((item) => item.id === segment.id ? { ...item, aircraft: event.target.value } : item))} placeholder="RA-00000" /></Field>
        <Field label="Цель"><select value={segment.purpose} onChange={(event) => setSegments((current) => current.map((item) => item.id === segment.id ? { ...item, purpose: event.target.value } : item))}>{flightPurposes.map((purpose) => <option key={purpose}>{purpose}</option>)}</select></Field>
        <Field label="Полётное" hint="0130 → 01:30"><TimeEntry value={segment.flight} onChange={(value) => setSegments((current) => current.map((item) => item.id === segment.id ? { ...item, flight: value } : item))} /></Field>
        <Field label="Ночь" hint="0045 → 00:45"><TimeEntry value={segment.night} onChange={(value) => setSegments((current) => current.map((item) => item.id === segment.id ? { ...item, night: value } : item))} /></Field>
        {segments.length > 1 && <button type="button" className="remove-segment" aria-label="Удалить полёт" onClick={() => setSegments((current) => current.filter((item) => item.id !== segment.id))}>×</button>}
      </div>)}</div>}
      {supportsPeriod && <div className="report-scope-note">Запись будет показана отдельно за каждый календарный день периода. Редактирование или удаление одного дня откроет весь связанный период.</div>}
      {error && <div className="form-error">{error}</div>}
      <Field label="Примечание"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Проверка, тренаж, особые обстоятельства…" /></Field>
      <div className="form-actions split">{onDelete && <button type="button" className="danger-button" onClick={onDelete}>{shift?.periodId ? "Удалить период" : "Удалить запись"}</button>}<span /><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button">{supportsPeriod ? "Сохранить период" : "Сохранить запись"}</button></div>
    </form>
  </Modal>;
}

function TimeEntry({ value, onChange, clock, required }: { value: string; onChange: (value: string) => void; clock?: boolean; required?: boolean }) {
  return <input type="text" inputMode="numeric" required={required} value={value} placeholder="0000" onChange={(event) => onChange(compactTime(event.target.value))} onBlur={() => { const normalized = normalizeTime(value, clock); if (normalized) onChange(normalized); }} />;
}

function CheckboxGroup({ label, options, values, onChange, columns = 3 }: { label: string; options: string[]; values: string[]; onChange: (values: string[]) => void; columns?: 3 | 4 }) {
  return <fieldset className={`checkbox-group columns-${columns}`}><legend>{label}</legend><div>{options.map((option) => <label key={option}><input type="checkbox" checked={values.includes(option)} onChange={(event) => onChange(event.target.checked ? [...values, option] : values.filter((value) => value !== option))} /><span>{option}</span></label>)}</div></fieldset>;
}

function Modal({ title, subtitle, onClose, wide, children }: { title: string; subtitle: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) { return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><div><p className="eyebrow">Штаб ЛС</p><h2 id="modal-title">{title}</h2><span>{subtitle}</span></div><button className="modal-close" aria-label="Закрыть" onClick={onClose}>×</button></header>{children}</section></div>; }
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="field"><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>; }
