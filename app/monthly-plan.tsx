"use client";

import { FormEvent, useMemo, useState } from "react";
import { aircraftNumbersByType } from "./aircraft-rules";
import {
  ActualBusyInput,
  aircraftTypeForNumber,
  availablePeopleForAssignment,
  dateInPlanEntry,
  monthDates,
  planBusyActivities,
  planBusyLabels,
  planPersonShortName,
  planRoleLabels,
  PlanAssignment,
  PlanBusyActivity,
  PlanBusyEntry,
  PlanRole,
} from "./monthly-plan-rules";
import { downloadMonthlyPlanExcel, downloadMonthlyPlanPdf } from "./monthly-plan-export";

type PlanPerson = {
  id: string;
  name: string;
  aircraftTypes: string[];
  active: boolean;
};

type PlanShift = ActualBusyInput;

const aircraftNumbers = Object.values(aircraftNumbersByType).flat();
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function localMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return "Выберите месяц";
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" })
    .format(new Date(`${month}-01T12:00:00`))
    .replace(" г.", "");
}

function shiftMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dayMeta(date: string) {
  const value = new Date(`${date}T12:00:00`);
  return {
    day: value.getDate(),
    weekday: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(value).replace(".", ""),
    weekend: value.getDay() === 0 || value.getDay() === 6,
  };
}

export function MonthlyPlanView({
  people,
  shifts,
  assignments,
  busyEntries,
  onSaveAssignment,
  onDeleteAssignment,
  onSaveBusy,
  onDeleteBusy,
  onNotify,
}: {
  people: PlanPerson[];
  shifts: PlanShift[];
  assignments: PlanAssignment[];
  busyEntries: PlanBusyEntry[];
  onSaveAssignment: (assignment: PlanAssignment) => void;
  onDeleteAssignment: (assignmentId: string) => void;
  onSaveBusy: (entry: PlanBusyEntry) => void;
  onDeleteBusy: (entryId: string) => void;
  onNotify: (message: string) => void;
}) {
  const [month, setMonth] = useState(localMonth);
  const [assignmentCell, setAssignmentCell] = useState<{ date: string; aircraft: string; role: PlanRole } | null>(null);
  const [busyModal, setBusyModal] = useState<PlanBusyEntry | "new" | null>(null);
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);
  const dates = useMemo(() => monthDates(month), [month]);
  const actualBusy = useMemo(() => shifts.filter((shift) => shift.activity !== "flight"), [shifts]);
  const monthAssignments = assignments.filter((assignment) => assignment.date.startsWith(month));
  const monthBusyEntries = dates.length
    ? busyEntries.filter((entry) => entry.dateFrom <= dates.at(-1)! && entry.dateTo >= dates[0])
    : [];
  const assignment = assignmentCell
    ? assignments.find((item) => item.date === assignmentCell.date && item.aircraft === assignmentCell.aircraft && item.role === assignmentCell.role)
    : undefined;
  const busyCount = new Set([
    ...monthBusyEntries.map((entry) => entry.personId),
    ...actualBusy.filter((entry) => entry.date.startsWith(month)).map((entry) => entry.personId),
  ]).size;
  async function exportPlan(format: "excel" | "pdf") {
    setExporting(format);
    try {
      if (format === "excel") await downloadMonthlyPlanExcel(month, people, shifts, assignments, busyEntries);
      else await downloadMonthlyPlanPdf(month, people, shifts, assignments, busyEntries);
      onNotify(`Месячный план сохранён в ${format === "excel" ? "Excel" : "PDF"}`);
    } catch {
      onNotify(`Не удалось сформировать ${format === "excel" ? "Excel" : "PDF"}`);
    } finally {
      setExporting(null);
    }
  }

  return <>
    <section className="panel plan-panel">
      <div className="panel-heading plan-heading">
        <div><p className="eyebrow">Планирование</p><h2>Месячный план лётного состава</h2></div>
        <div className="plan-heading-actions">
          <button type="button" className="secondary-button" onClick={() => setMonth(shiftMonth(month, -1))}>←</button>
          <label className="plan-month-picker"><span>Месяц</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value || localMonth())} /></label>
          <button type="button" className="secondary-button" onClick={() => setMonth(shiftMonth(month, 1))}>→</button>
          <button type="button" className="secondary-button" onClick={() => setMonth(localMonth())}>Текущий месяц</button>
          <button type="button" className="secondary-button plan-export-button" disabled={Boolean(exporting)} onClick={() => exportPlan("excel")}>{exporting === "excel" ? "Excel…" : "Excel"}</button>
          <button type="button" className="secondary-button plan-export-button" disabled={Boolean(exporting)} onClick={() => exportPlan("pdf")}>{exporting === "pdf" ? "PDF…" : "PDF"}</button>
          <button type="button" className="primary-button" onClick={() => setBusyModal("new")}>+ Добавить занятость</button>
        </div>
      </div>
      <div className="plan-summary">
        <strong>{monthLabel(month)}</strong>
        <span>Назначений: {monthAssignments.length}</span>
        <span>Занятых сотрудников: {busyCount}</span>
        <span>Нажмите ячейку «Основной» или «Резерв», чтобы назначить пилота.</span>
      </div>
      <div className="plan-table-scroll">
        <table className="plan-table">
          <thead><tr><th className="plan-aircraft-head">Борт</th><th className="plan-role-head">Экипаж</th>{dates.map((date) => {
            const meta = dayMeta(date);
            return <th className={meta.weekend ? "weekend" : ""} key={date}><strong>{String(meta.day).padStart(2, "0")}</strong><span>{meta.weekday}</span></th>;
          })}</tr></thead>
          <tbody>
            {aircraftNumbers.flatMap((aircraft) => (["primary", "reserve"] as PlanRole[]).map((role, roleIndex) => {
              const aircraftType = aircraftTypeForNumber(aircraft, aircraftNumbersByType);
              return <tr className={`plan-aircraft-row ${role}`} key={`${aircraft}-${role}`}>
                {roleIndex === 0 && <th className="plan-aircraft-name" rowSpan={2}><strong>{aircraft}</strong><span>{aircraftType}</span></th>}
                <th className="plan-role-name">{planRoleLabels[role]}</th>
                {dates.map((date) => {
                  const current = assignments.find((item) => item.date === date && item.aircraft === aircraft && item.role === role);
                  const person = people.find((item) => item.id === current?.personId);
                  const weekend = dayMeta(date).weekend;
                  return <td className={weekend ? "weekend" : ""} key={date}><button type="button" className={current ? "filled" : ""} onClick={() => setAssignmentCell({ date, aircraft, role })}>{person ? planPersonShortName(person.name) : "+"}</button></td>;
                })}
              </tr>;
            }))}
            <tr className="plan-divider"><td colSpan={dates.length + 2}>Занятость вне полётного плана</td></tr>
            {planBusyActivities.map((activity) => <tr className={`plan-busy-row ${activity}`} key={activity}>
              <th className="plan-busy-name" colSpan={2}>{planBusyLabels[activity]}</th>
              {dates.map((date) => {
                const planned = busyEntries.filter((entry) => entry.activity === activity && dateInPlanEntry(date, entry));
                const actual = actualBusy.filter((entry) => entry.activity === activity && entry.date === date);
                const uniquePeople = [...new Set([...planned.map((entry) => entry.personId), ...actual.map((entry) => entry.personId)])];
                return <td className={dayMeta(date).weekend ? "weekend" : ""} key={date}>
                  <div className="plan-busy-cell">{uniquePeople.map((personId) => {
                    const person = people.find((item) => item.id === personId);
                    const editable = planned.find((entry) => entry.personId === personId);
                    return person ? <button type="button" title={editable ? "Изменить плановую занятость" : "Запись из журнала смен"} onClick={() => editable && setBusyModal(editable)} className={editable ? "editable" : "actual"} key={personId}>{planPersonShortName(person.name)}</button> : null;
                  })}</div>
                </td>;
              })}
            </tr>)}
          </tbody>
        </table>
      </div>
      <div className="plan-legend"><span><i className="primary" />Основной экипаж</span><span><i className="reserve" />Резерв</span><span><i className="busy" />Занятость блокирует назначение на полёт</span></div>
    </section>
    {assignmentCell && <AssignmentModal
      cell={assignmentCell}
      assignment={assignment}
      people={people}
      assignments={assignments}
      busyEntries={busyEntries}
      actualBusy={actualBusy}
      onClose={() => setAssignmentCell(null)}
      onSave={(personId) => {
        onSaveAssignment({ id: assignment?.id ?? uid(), ...assignmentCell, personId });
        setAssignmentCell(null);
      }}
      onDelete={assignment ? () => { onDeleteAssignment(assignment.id); setAssignmentCell(null); } : undefined}
    />}
    {busyModal && <BusyModal
      people={people}
      entry={busyModal === "new" ? null : busyModal}
      month={month}
      assignments={assignments}
      onClose={() => setBusyModal(null)}
      onSave={(entry) => { onSaveBusy(entry); setBusyModal(null); }}
      onDelete={busyModal === "new" ? undefined : () => { onDeleteBusy(busyModal.id); setBusyModal(null); }}
      onNotify={onNotify}
    />}
  </>;
}

function AssignmentModal({
  cell,
  assignment,
  people,
  assignments,
  busyEntries,
  actualBusy,
  onClose,
  onSave,
  onDelete,
}: {
  cell: { date: string; aircraft: string; role: PlanRole };
  assignment?: PlanAssignment;
  people: PlanPerson[];
  assignments: PlanAssignment[];
  busyEntries: PlanBusyEntry[];
  actualBusy: ActualBusyInput[];
  onClose: () => void;
  onSave: (personId: string) => void;
  onDelete?: () => void;
}) {
  const aircraftType = aircraftTypeForNumber(cell.aircraft, aircraftNumbersByType);
  const availablePeople = availablePeopleForAssignment(people, assignments, busyEntries, actualBusy, cell.date, aircraftType, cell.aircraft, assignment?.id);
  const [personId, setPersonId] = useState(assignment?.personId ?? "");
  const selectedPersonId = availablePeople.some((person) => person.id === personId) ? personId : "";

  return <PlanModal title="Назначение на борт" subtitle={`${cell.aircraft} · ${aircraftType} · ${planRoleLabels[cell.role]} · ${new Intl.DateTimeFormat("ru-RU").format(new Date(`${cell.date}T12:00:00`))}`} onClose={onClose}>
    <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (selectedPersonId) onSave(selectedPersonId); }}>
      <label className="field"><span>Сотрудник</span><select required autoFocus value={selectedPersonId} onChange={(event) => setPersonId(event.target.value)}><option value="">Выберите доступного сотрудника</option>{availablePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      {!availablePeople.length && <div className="form-error">Нет доступных сотрудников с допуском на {aircraftType}. Проверьте занятость и назначение на этот борт.</div>}
      <div className="form-actions split">{onDelete && <button type="button" className="danger-button" onClick={onDelete}>Очистить ячейку</button>}<span /><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button" disabled={!selectedPersonId}>Сохранить</button></div>
    </form>
  </PlanModal>;
}

function BusyModal({
  people,
  entry,
  month,
  assignments,
  onClose,
  onSave,
  onDelete,
  onNotify,
}: {
  people: PlanPerson[];
  entry: PlanBusyEntry | null;
  month: string;
  assignments: PlanAssignment[];
  onClose: () => void;
  onSave: (entry: PlanBusyEntry) => void;
  onDelete?: () => void;
  onNotify: (message: string) => void;
}) {
  const firstDate = `${month}-01`;
  const [personId, setPersonId] = useState(entry?.personId ?? "");
  const [activity, setActivity] = useState<PlanBusyActivity>(entry?.activity ?? "vacation");
  const [dateFrom, setDateFrom] = useState(entry?.dateFrom ?? firstDate);
  const [dateTo, setDateTo] = useState(entry?.dateTo ?? firstDate);
  const [note, setNote] = useState(entry?.note ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!personId || !dateFrom || !dateTo || dateTo < dateFrom) return;
    const conflicts = assignments.filter((assignment) =>
      assignment.personId === personId && assignment.date >= dateFrom && assignment.date <= dateTo);
    if (conflicts.length && !window.confirm(`У сотрудника есть ${conflicts.length} назначений на борта в выбранном периоде. Сохранить занятость и удалить эти назначения?`)) return;
    if (conflicts.length) onNotify(`Удалено назначений на полёт: ${conflicts.length}`);
    onSave({ id: entry?.id ?? uid(), personId, activity, dateFrom, dateTo, note: note.trim() });
  }

  return <PlanModal title={entry ? "Изменение занятости" : "Новая занятость"} subtitle="Занятость исключает сотрудника из назначения на полёты" onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <label className="field"><span>Сотрудник</span><select required autoFocus value={personId} onChange={(event) => setPersonId(event.target.value)}><option value="">Выберите сотрудника</option>{people.filter((person) => person.active).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label className="field"><span>Вид занятости</span><select value={activity} onChange={(event) => setActivity(event.target.value as PlanBusyActivity)}>{planBusyActivities.map((item) => <option key={item} value={item}>{planBusyLabels[item]}</option>)}</select></label>
      <div className="form-grid two"><label className="field"><span>Период с</span><input required type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); if (dateTo < event.target.value) setDateTo(event.target.value); }} /></label><label className="field"><span>Период по</span><input required type="date" min={dateFrom} value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label></div>
      <label className="field"><span>Примечание</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Подразделение, программа подготовки, место командировки…" /></label>
      <div className="form-actions split">{onDelete && <button type="button" className="danger-button" onClick={onDelete}>Удалить занятость</button>}<span /><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button">Сохранить</button></div>
    </form>
  </PlanModal>;
}

function PlanModal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true"><header><div><p className="eyebrow">Месячный план</p><h2>{title}</h2><span>{subtitle}</span></div><button type="button" className="modal-close" aria-label="Закрыть" onClick={onClose}>×</button></header>{children}</section></div>;
}
