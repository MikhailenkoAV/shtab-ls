"use client";

import { useState } from "react";
import { aircraftNumbersByType } from "./aircraft-rules";
import { isMonthlyPlanAircraft, planRoleLabels, PlanAssignment } from "./monthly-plan-rules";
import { readinessForOperator } from "./readiness-rules";
import type { EmployeeReadiness } from "./readiness-rules";

type CrewPerson = { id: string; name: string; active: boolean };
type CrewShift = { id: string; personId: string; date: string; activity: string; segments: { aircraft: string; aircraftType?: string }[] };

const aircraft = Object.entries(aircraftNumbersByType)
  .flatMap(([type, numbers]) => numbers.filter(isMonthlyPlanAircraft).map((number) => ({ type, number })));
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const moveDate = (date: string, days: number) => { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + days); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; };

export function CrewDeploymentView({ people, assignments, shifts, readiness, onOpenPlan }: {
  people: CrewPerson[];
  assignments: PlanAssignment[];
  shifts: CrewShift[];
  readiness: Record<string, EmployeeReadiness>;
  onOpenPlan: (assignment?: PlanAssignment) => void;
}) {
  const [date, setDate] = useState(localDate);
  const dailyAssignments = assignments.filter((item) => item.date === date && isMonthlyPlanAircraft(item.aircraft));
  const dailyShifts = shifts.filter((item) => item.date === date && item.activity === "flight");
  const assignedPeople = new Set(dailyAssignments.map((item) => item.personId));
  const ready = [...assignedPeople].filter((id) => readiness[id]?.status === "allowed").length;
  const restricted = [...assignedPeople].filter((id) => readiness[id]?.status === "restricted" || readiness[id]?.status === "undetermined").length;
  const blocked = [...assignedPeople].filter((id) => readiness[id]?.status === "not_allowed").length;

  return <section className="crew-deployment">
    <div className="panel crew-toolbar"><div><p className="eyebrow">Оперативное планирование</p><h2>Расстановка экипажей</h2></div><div className="crew-date-controls"><button className="secondary-button" onClick={() => setDate(moveDate(date, -1))}>←</button><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /><button className="secondary-button" onClick={() => setDate(moveDate(date, 1))}>→</button><button className="secondary-button" onClick={() => setDate(localDate())}>Сегодня</button><button className="primary-button" onClick={() => window.print()}>Печатная форма</button></div></div>
    <div className="crew-summary"><span>Назначено: <strong>{assignedPeople.size}</strong></span><span className="allowed">Готовы: <strong>{ready}</strong></span><span className="restricted">Ограничения: <strong>{restricted}</strong></span><span className="not_allowed">Не допущены: <strong>{blocked}</strong></span></div>
    <div className="crew-grid">{aircraft.map((board) => {
      const rows = dailyAssignments.filter((item) => item.aircraft === board.number);
      const fact = dailyShifts.filter((shift) => shift.segments.some((segment) => segment.aircraft === board.number));
      const boardBlocked = rows.some((item) => readinessForOperator(readiness[item.personId], item.operator, board.type)?.status === "not_allowed");
      const boardRestricted = rows.some((item) => ["restricted", "undetermined"].includes(readinessForOperator(readiness[item.personId], item.operator, board.type)?.status ?? ""));
      const state = boardBlocked ? "not_allowed" : boardRestricted ? "restricted" : rows.length ? "allowed" : "undetermined";
      return <article className={`panel crew-board ${state}`} key={board.number}>
        <header><div><strong>{board.number}</strong><span>{board.type}</span></div><i>{state === "allowed" ? "Экипаж готов" : state === "restricted" ? "Требует проверки" : state === "not_allowed" ? "Есть запрет" : "Не назначен"}</i></header>
        {(["primary", "reserve"] as const).map((role) => { const row = rows.find((item) => item.role === role); const person = people.find((item) => item.id === row?.personId); const status = person ? readinessForOperator(readiness[person.id], row?.operator, board.type) : undefined; return <button className="crew-slot" key={role} onClick={() => onOpenPlan(row)}><span>{planRoleLabels[role]}{row?.operator ? ` · ${row.operator}` : ""}</span><strong>{person?.name ?? "+ Назначить"}</strong>{status && <small className={status.status}>{status.label}{status.reasons[0] ? ` · ${status.reasons[0].detail}` : ""}</small>}</button>; })}
        <footer>{fact.length ? <><b>Факт:</b>{fact.map((shift) => <span key={shift.id}>{people.find((item) => item.id === shift.personId)?.name ?? "Сотрудник"}</span>)}</> : <span>Фактических полётов за дату нет</span>}</footer>
      </article>;
    })}</div>
  </section>;
}
