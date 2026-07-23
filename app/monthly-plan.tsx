"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { aircraftNumbersByType } from "./aircraft-rules";
import {
  ActualBusyInput,
  assignmentBlockReason,
  aircraftTypeForNumber,
  availablePeopleForAssignment,
  busyBlockReason,
  dateInPlanEntry,
  datesInRange,
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
import { downloadMonthlyPlanExcel } from "./monthly-plan-export";

type PlanPerson = {
  id: string;
  name: string;
  aircraftTypes: string[];
  active: boolean;
};

type PlanShift = ActualBusyInput;

export type PlanEditRequest =
  | { kind: "assignment"; id: string }
  | { kind: "busy"; id: string };

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
  onSaveAssignments,
  onDeleteAssignment,
  onSaveBusy,
  onSaveBusyEntries,
  onDeleteBusy,
  onNotify,
  editRequest,
  onEditRequestHandled,
}: {
  people: PlanPerson[];
  shifts: PlanShift[];
  assignments: PlanAssignment[];
  busyEntries: PlanBusyEntry[];
  onSaveAssignment: (assignment: PlanAssignment) => void;
  onSaveAssignments: (assignments: PlanAssignment[]) => void;
  onDeleteAssignment: (assignmentId: string) => void;
  onSaveBusy: (entry: PlanBusyEntry) => void;
  onSaveBusyEntries: (entries: PlanBusyEntry[]) => void;
  onDeleteBusy: (entryId: string) => void;
  onNotify: (message: string) => void;
  editRequest?: PlanEditRequest | null;
  onEditRequestHandled?: () => void;
}) {
  const requestedAssignment = editRequest?.kind === "assignment"
    ? assignments.find((item) => item.id === editRequest.id)
    : undefined;
  const requestedBusy = editRequest?.kind === "busy"
    ? busyEntries.find((item) => item.id === editRequest.id)
    : undefined;
  const [month, setMonth] = useState(requestedAssignment?.date.slice(0, 7) ?? requestedBusy?.dateFrom.slice(0, 7) ?? localMonth);
  const [assignmentCell, setAssignmentCell] = useState<{ date: string; aircraft: string; role: PlanRole } | null>(
    requestedAssignment
      ? { date: requestedAssignment.date, aircraft: requestedAssignment.aircraft, role: requestedAssignment.role }
      : null,
  );
  const [busyModal, setBusyModal] = useState<PlanBusyEntry | "new" | null>(requestedBusy ?? null);
  const [employmentModal, setEmploymentModal] = useState(false);
  const [exporting, setExporting] = useState(false);
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
  useEffect(() => {
    if (!editRequest) return;
    onEditRequestHandled?.();
  }, [editRequest, onEditRequestHandled]);
  async function exportPlan() {
    setExporting(true);
    try {
      await downloadMonthlyPlanExcel(month, people, shifts, assignments, busyEntries);
      onNotify("Месячный план сохранён в Excel");
    } catch {
      onNotify("Не удалось сформировать Excel");
    } finally {
      setExporting(false);
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
          <button type="button" className="secondary-button plan-export-button" disabled={exporting} onClick={exportPlan}>{exporting ? "Excel…" : "Выгрузить в Excel"}</button>
          <button type="button" className="primary-button" onClick={() => setEmploymentModal(true)}>+ Запись занятости</button>
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
      actualBusy={shifts}
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
      busyEntries={busyEntries}
      actualBusy={shifts}
      onClose={() => setBusyModal(null)}
      onSave={(entry) => { onSaveBusy(entry); setBusyModal(null); }}
      onDelete={busyModal === "new" ? undefined : () => { onDeleteBusy(busyModal.id); setBusyModal(null); }}
    />}
    {employmentModal && <EmploymentPlannerModal
      people={people}
      month={month}
      assignments={assignments}
      busyEntries={busyEntries}
      actualBusy={shifts}
      onClose={() => setEmploymentModal(false)}
      onSaveAssignments={(items) => {
        onSaveAssignments(items);
        setEmploymentModal(false);
      }}
      onSaveBusyEntries={(items) => {
        onSaveBusyEntries(items);
        setEmploymentModal(false);
      }}
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
  busyEntries,
  actualBusy,
  onClose,
  onSave,
  onDelete,
}: {
  people: PlanPerson[];
  entry: PlanBusyEntry | null;
  month: string;
  assignments: PlanAssignment[];
  busyEntries: PlanBusyEntry[];
  actualBusy: ActualBusyInput[];
  onClose: () => void;
  onSave: (entry: PlanBusyEntry) => void;
  onDelete?: () => void;
}) {
  const firstDate = `${month}-01`;
  const [personId, setPersonId] = useState(entry?.personId ?? "");
  const [activity, setActivity] = useState<PlanBusyActivity>(entry?.activity ?? "vacation");
  const [dateFrom, setDateFrom] = useState(entry?.dateFrom ?? firstDate);
  const [dateTo, setDateTo] = useState(entry?.dateTo ?? firstDate);
  const [note, setNote] = useState(entry?.note ?? "");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!personId || !dateFrom || !dateTo || dateTo < dateFrom) return;
    const conflict = datesInRange(dateFrom, dateTo)
      .map((date) => ({ date, reason: busyBlockReason(personId, date, assignments, busyEntries, actualBusy, entry?.id) }))
      .find((item) => item.reason);
    if (conflict) {
      setError(`${new Intl.DateTimeFormat("ru-RU").format(new Date(`${conflict.date}T12:00:00`))}: ${conflict.reason}`);
      return;
    }
    onSave({ id: entry?.id ?? uid(), personId, activity, dateFrom, dateTo, note: note.trim() });
  }

  return <PlanModal title={entry ? "Изменение занятости" : "Новая занятость"} subtitle="Занятость исключает сотрудника из назначения на полёты" onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <label className="field"><span>Сотрудник</span><select required autoFocus value={personId} onChange={(event) => setPersonId(event.target.value)}><option value="">Выберите сотрудника</option>{people.filter((person) => person.active).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label className="field"><span>Вид занятости</span><select value={activity} onChange={(event) => setActivity(event.target.value as PlanBusyActivity)}>{planBusyActivities.map((item) => <option key={item} value={item}>{planBusyLabels[item]}</option>)}</select></label>
      <div className="form-grid two"><label className="field"><span>Период с</span><input required type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); if (dateTo < event.target.value) setDateTo(event.target.value); }} /></label><label className="field"><span>Период по</span><input required type="date" min={dateFrom} value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label></div>
      <label className="field"><span>Примечание</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Подразделение, программа подготовки, место командировки…" /></label>
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions split">{onDelete && <button type="button" className="danger-button" onClick={onDelete}>Удалить занятость</button>}<span /><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button">Сохранить</button></div>
    </form>
  </PlanModal>;
}

type EmploymentActivity = "flight" | PlanBusyActivity;

function EmploymentPlannerModal({
  people,
  month,
  assignments,
  busyEntries,
  actualBusy,
  onClose,
  onSaveAssignments,
  onSaveBusyEntries,
}: {
  people: PlanPerson[];
  month: string;
  assignments: PlanAssignment[];
  busyEntries: PlanBusyEntry[];
  actualBusy: ActualBusyInput[];
  onClose: () => void;
  onSaveAssignments: (assignments: PlanAssignment[]) => void;
  onSaveBusyEntries: (entries: PlanBusyEntry[]) => void;
}) {
  const firstDate = `${month}-01`;
  const [personId, setPersonId] = useState("");
  const [activity, setActivity] = useState<EmploymentActivity>("flight");
  const [dateFrom, setDateFrom] = useState(firstDate);
  const [dateTo, setDateTo] = useState(firstDate);
  const [selectedDates, setSelectedDates] = useState<string[]>([firstDate]);
  const [selectedAircraft, setSelectedAircraft] = useState<string[]>([]);
  const [role, setRole] = useState<PlanRole>("primary");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const person = people.find((item) => item.id === personId);
  const dates = datesInRange(dateFrom, dateTo);
  const allowedAircraft = aircraftNumbers.filter((aircraft) =>
    person?.aircraftTypes.includes(aircraftTypeForNumber(aircraft, aircraftNumbersByType)));

  function setRange(dateFromValue: string, dateToValue: string) {
    setDateFrom(dateFromValue);
    setDateTo(dateToValue);
    setSelectedDates(datesInRange(dateFromValue, dateToValue));
    setError("");
  }

  function dateBlockReason(date: string): string | null {
    if (!person) return "Сначала выберите сотрудника.";
    if (activity !== "flight") {
      return busyBlockReason(person.id, date, assignments, busyEntries, actualBusy);
    }
    if (!selectedAircraft.length) return "Выберите хотя бы один борт.";
    for (const aircraft of selectedAircraft) {
      const occupied = assignments.find((item) =>
        item.date === date && item.aircraft === aircraft && item.role === role && item.personId !== person.id);
      if (occupied) return `${aircraft}: место «${planRoleLabels[role]}» уже занято.`;
      const reason = assignmentBlockReason({
        person,
        assignments,
        busyEntries,
        actualBusy,
        date,
        aircraftType: aircraftTypeForNumber(aircraft, aircraftNumbersByType),
        aircraft,
      });
      if (reason) return reason;
    }
    return null;
  }

  const readyDates = selectedDates.filter((date) => dates.includes(date) && !dateBlockReason(date));

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!person) {
      setError("Выберите сотрудника.");
      return;
    }
    if (!dates.length || dateTo < dateFrom) {
      setError("Проверьте выбранный период.");
      return;
    }
    if (!readyDates.length) {
      const firstBlocked = dates.map((date) => ({ date, reason: dateBlockReason(date) })).find((item) => item.reason);
      setError(firstBlocked
        ? `${new Intl.DateTimeFormat("ru-RU").format(new Date(`${firstBlocked.date}T12:00:00`))}: ${firstBlocked.reason}`
        : "Выберите хотя бы один доступный день.");
      return;
    }
    if (activity === "flight") {
      onSaveAssignments(readyDates.flatMap((date) => selectedAircraft.map((aircraft) => ({
        id: uid(),
        personId: person.id,
        date,
        aircraft,
        role,
      }))));
      return;
    }
    onSaveBusyEntries(readyDates.map((date) => ({
      id: uid(),
      personId: person.id,
      activity,
      dateFrom: date,
      dateTo: date,
      note: note.trim(),
    })));
  }

  return <PlanModal title="Запись занятости сотрудника" subtitle="Один сотрудник · один день, несколько дат или период" onClose={onClose} wide>
    <form className="form-stack employment-planner" onSubmit={submit}>
      <div className="form-grid two">
        <label className="field"><span>Сотрудник</span><select required autoFocus value={personId} onChange={(event) => {
          setPersonId(event.target.value);
          setSelectedAircraft([]);
          setError("");
        }}><option value="">Выберите сотрудника</option>{people.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field"><span>Вид занятости</span><select value={activity} onChange={(event) => {
          setActivity(event.target.value as EmploymentActivity);
          setError("");
        }}><option value="flight">Полётная смена</option>{planBusyActivities.map((item) => <option key={item} value={item}>{planBusyLabels[item]}</option>)}</select></label>
      </div>
      <div className="form-grid two">
        <label className="field"><span>Период с</span><input required type="date" value={dateFrom} onChange={(event) => {
          const nextFrom = event.target.value;
          setRange(nextFrom, dateTo < nextFrom ? nextFrom : dateTo);
        }} /></label>
        <label className="field"><span>Период по</span><input required type="date" min={dateFrom} value={dateTo} onChange={(event) => setRange(dateFrom, event.target.value)} /></label>
      </div>
      {activity === "flight" && <section className="employment-aircraft">
        <div className="section-label"><strong>Борта из допусков сотрудника</strong><span>{selectedAircraft.length}</span></div>
        {!person ? <div className="planner-hint">Сначала выберите сотрудника.</div> : !allowedAircraft.length ? <div className="form-error">Для типов ВС сотрудника нет настроенных бортовых номеров.</div> : <div className="aircraft-choice-grid">{allowedAircraft.map((aircraft) => {
          const aircraftType = aircraftTypeForNumber(aircraft, aircraftNumbersByType);
          return <label key={aircraft}><input type="checkbox" checked={selectedAircraft.includes(aircraft)} onChange={(event) => setSelectedAircraft((current) =>
            event.target.checked ? [...current, aircraft] : current.filter((item) => item !== aircraft))} /><span><strong>{aircraft}</strong><small>{aircraftType}</small></span></label>;
        })}</div>}
        <label className="field"><span>Роль в плане</span><select value={role} onChange={(event) => setRole(event.target.value as PlanRole)}>{(["primary", "reserve"] as PlanRole[]).map((item) => <option key={item} value={item}>{planRoleLabels[item]}</option>)}</select></label>
      </section>}
      <section className="employment-days">
        <div className="section-label"><strong>Дни применения</strong><span>{readyDates.length} из {dates.length}</span></div>
        <div className="planner-hint">Нажмите день, чтобы включить или исключить его. Недоступный день отмечен красным; наведите курсор, чтобы увидеть причину.</div>
        <div className="employment-day-grid">{dates.map((date) => {
          const reason = dateBlockReason(date);
          const selected = selectedDates.includes(date) && !reason;
          const meta = dayMeta(date);
          return <button
            type="button"
            key={date}
            className={`${selected ? "selected" : ""} ${reason ? "blocked" : ""}`}
            title={reason ?? (selected ? "Включено в запись" : "Исключено из записи")}
            disabled={Boolean(reason)}
            onClick={() => setSelectedDates((current) =>
              current.includes(date) ? current.filter((item) => item !== date) : [...current, date])}
          ><strong>{String(meta.day).padStart(2, "0")}</strong><span>{meta.weekday}</span>{reason && <i>!</i>}</button>;
        })}</div>
      </section>
      {activity !== "flight" && <label className="field"><span>Примечание</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Место, программа, основание…" /></label>}
      <div className="report-scope-note">Запись сразу появится в месячном плане и в разделе «Полётные смены». Фактическое время и налёт по выполненному полёту затем вносятся обычной записью смены.</div>
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button">Применить занятость</button></div>
    </form>
  </PlanModal>;
}

function PlanModal({ title, subtitle, onClose, wide, children }: { title: string; subtitle: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true"><header><div><p className="eyebrow">Месячный план</p><h2>{title}</h2><span>{subtitle}</span></div><button type="button" className="modal-close" aria-label="Закрыть" onClick={onClose}>×</button></header>{children}</section></div>;
}
