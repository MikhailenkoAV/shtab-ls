"use client";

import { useMemo, useState } from "react";
import { downloadActualPlanExcel } from "./actual-plan-export";

export type ActualPlanPerson = {
  id: string;
  name: string;
  active: boolean;
};

export type ActualPlanShift = {
  id: string;
  personId: string;
  date: string;
  activity: string;
  start?: string;
  workMinutes?: number;
  note?: string;
  linkedSourceShiftId?: string;
  segments?: {
    aircraft?: string;
    aircraftType?: string;
    seat?: string;
  }[];
};

const activityLabels: Record<string, string> = {
  flight: "Полётная смена",
  trip: "Командировка",
  office: "Работа в офисе",
  periodic_training: "Периодическая подготовка",
  ground_training: "Наземная подготовка",
  standby: "Ожидание полёта",
  vacation: "Отпуск",
  dayoff: "Выходной",
};

function currentMonth(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function changeMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthDates(month: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const [year, monthNumber] = month.split("-").map(Number);
  const count = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" })
    .format(new Date(`${month}-01T12:00:00`))
    .replace(" г.", "");
}

function dayMeta(date: string) {
  const value = new Date(`${date}T12:00:00`);
  return {
    day: value.getDate(),
    weekday: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(value).replace(".", ""),
    weekend: value.getDay() === 0 || value.getDay() === 6,
  };
}

function flightLabel(shift: ActualPlanShift): string {
  const segments = shift.segments ?? [];
  const aircraftTypes = [...new Set(segments.map((segment) => segment.aircraftType).filter(Boolean))];
  const aircraft = [...new Set(segments.map((segment) => segment.aircraft).filter(Boolean))];
  return [aircraftTypes.join("/"), aircraft.join("/")].filter(Boolean).join(" · ") || "Полёт";
}

function shiftTitle(shift: ActualPlanShift): string {
  const activity = activityLabels[shift.activity] ?? shift.activity;
  const time = shift.start ? ` · ${shift.start}` : "";
  const aircraft = shift.activity === "flight" ? ` · ${flightLabel(shift)}` : "";
  const note = shift.note ? ` · ${shift.note}` : "";
  return `${activity}${time}${aircraft}${note}`;
}

export function ActualPlanView({
  people,
  shifts,
  onAdd,
  onEdit,
  onNotify,
}: {
  people: ActualPlanPerson[];
  shifts: ActualPlanShift[];
  onAdd: (personId: string, date: string) => void;
  onEdit: (shift: ActualPlanShift) => void;
  onNotify: (message: string) => void;
}) {
  const [month, setMonth] = useState(currentMonth);
  const [exporting, setExporting] = useState(false);
  const dates = useMemo(() => monthDates(month), [month]);
  const includedPeople = useMemo(() => people
    .filter((person) => person.active || shifts.some((shift) => shift.personId === person.id && shift.date.startsWith(month)))
    .sort((left, right) => left.name.localeCompare(right.name, "ru-RU")), [month, people, shifts]);
  const monthShifts = useMemo(() => shifts
    .filter((shift) => shift.date.startsWith(month))
    .sort((left, right) => `${left.date}${left.start ?? ""}`.localeCompare(`${right.date}${right.start ?? ""}`)), [month, shifts]);
  const occupiedDays = new Set(monthShifts.map((shift) => `${shift.personId}|${shift.date}`)).size;
  async function exportPlan() {
    setExporting(true);
    try {
      await downloadActualPlanExcel(month, people, shifts);
      onNotify("Фактический план сохранён в Excel");
    } catch {
      onNotify("Не удалось сформировать Excel");
    } finally {
      setExporting(false);
    }
  }

  return <section className="panel actual-plan-panel">
    <div className="panel-heading actual-plan-heading">
      <div><p className="eyebrow">Фактическая занятость</p><h2>Фактический план лётного состава</h2></div>
      <div className="plan-heading-actions">
        <button type="button" className="secondary-button" onClick={() => setMonth(changeMonth(month, -1))}>←</button>
        <label className="plan-month-picker"><span>Месяц</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value || currentMonth())} /></label>
        <button type="button" className="secondary-button" onClick={() => setMonth(changeMonth(month, 1))}>→</button>
        <button type="button" className="secondary-button" onClick={() => setMonth(currentMonth())}>Текущий месяц</button>
        <button type="button" className="secondary-button plan-export-button" disabled={exporting} onClick={exportPlan}>{exporting ? "Excel…" : "Выгрузить в Excel"}</button>
      </div>
    </div>
    <div className="plan-summary">
      <strong>{monthLabel(month)}</strong>
      <span>Фактических записей: {monthShifts.length}</span>
      <span>Занятых человеко-дней: {occupiedDays}</span>
      <span>«+» добавляет запись в журнал; существующая запись открывается для редактирования.</span>
    </div>
    {!includedPeople.length ? <div className="panel-empty tall">В личном составе пока нет сотрудников.</div> : <div className="actual-plan-scroll">
      <table className="actual-plan-table">
        <thead><tr><th className="actual-person-head">Сотрудник</th>{dates.map((date) => {
          const meta = dayMeta(date);
          return <th className={meta.weekend ? "weekend" : ""} key={date}><strong>{String(meta.day).padStart(2, "0")}</strong><span>{meta.weekday}</span></th>;
        })}</tr></thead>
        <tbody>{includedPeople.map((person) => <tr key={person.id}>
          <th className="actual-person-name">{person.name}</th>
          {dates.map((date) => {
            const entries = monthShifts.filter((shift) => shift.personId === person.id && shift.date === date);
            return <td className={dayMeta(date).weekend ? "weekend" : ""} key={date}>
              <div className="actual-day-cell">{entries.map((shift) => <button
                type="button"
                key={shift.id}
                className={`actual-entry ${shift.activity}`}
                title={shiftTitle(shift)}
                onClick={() => onEdit(shift)}
              ><strong>{shift.activity === "flight" ? flightLabel(shift) : activityLabels[shift.activity] ?? shift.activity}</strong>{shift.start && <span>{shift.start}</span>}</button>)}<button
                type="button"
                className="actual-day-add"
                title={`Добавить фактическую занятость · ${person.name} · ${new Intl.DateTimeFormat("ru-RU").format(new Date(`${date}T12:00:00`))}`}
                aria-label={`Добавить запись: ${person.name}, ${date}`}
                onClick={() => onAdd(person.id, date)}
              >+</button></div>
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>}
    <div className="actual-plan-legend">
      {Object.entries(activityLabels).map(([activity, label]) => <span key={activity}><i className={activity} />{label}</span>)}
    </div>
  </section>;
}
