"use client";

import { useState } from "react";
import type { CertificationRecord, PersonRef } from "./personal-files";
import { getExpiryState, latestCertificationRecords } from "./personal-files-rules";
import type { PersonalDocumentDefinition } from "./pilot-profile-rules";
import type { PlanBusyEntry } from "./monthly-plan-rules";
import { canonicalAircraft, typeSpecificTraining } from "./training-matrix-rules";

const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const displayDate = (value: string) => value ? new Intl.DateTimeFormat("ru-RU").format(new Date(`${value}T12:00:00`)) : "—";
const normalized = (value: string) => value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/[^a-zа-я0-9]+/g, " ").trim();
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function suggestionDate(endDate: string): string {
  if (!endDate) return localDate();
  const date = new Date(`${endDate}T12:00:00`);
  date.setDate(date.getDate() - 30);
  const proposed = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return proposed < localDate() ? localDate() : proposed;
}

export function TrainingMatrixView({ people, records, definitions, busyEntries, onOpenPerson, onPlan, onNotify }: {
  people: PersonRef[];
  records: CertificationRecord[];
  definitions: PersonalDocumentDefinition[];
  busyEntries: PlanBusyEntry[];
  onOpenPerson: (personId: string) => void;
  onPlan: (entry: PlanBusyEntry) => void;
  onNotify: (message: string) => void;
}) {
  const [operator, setOperator] = useState("");
  const [aircraft, setAircraft] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const columns = definitions.filter((item) => item.group === "flight_training" || item.group === "periodic_training");
  const operators = [...new Set(people.flatMap((person) => person.qualifications.flatMap((item) => item.operators)))].sort();
  const aircraftTypes = [...new Set(people.flatMap((person) => person.aircraftTypes))].sort();
  const rows = people.filter((person) => person.active)
    .flatMap((person) => (person.aircraftTypes.length ? person.aircraftTypes : [""]).map((aircraftType) => ({
      person,
      aircraftType,
      operators: [...new Set(person.qualifications.filter((item) => item.aircraftTypes.some((type) => canonicalAircraft(type) === canonicalAircraft(aircraftType))).flatMap((item) => item.operators))],
    })))
    .filter((row) => !operator || row.operators.includes(operator))
    .filter((row) => !aircraft || canonicalAircraft(row.aircraftType) === canonicalAircraft(aircraft))
    .map(({ person, aircraftType, operators: rowOperators }) => {
      const current = latestCertificationRecords(records.filter((record) => record.personId === person.id));
      const cells = columns.map((definition) => {
        const isTyped = typeSpecificTraining(definition.name);
        const matches = current.filter((record) => normalized(`${record.certificationType} ${record.documentType}`).includes(normalized(definition.name)) && (!isTyped || canonicalAircraft(record.aircraftType) === canonicalAircraft(aircraftType)));
        const record = [...matches].sort((a, b) => (b.endDate || b.issuedDate).localeCompare(a.endDate || a.issuedDate))[0];
        const state = record ? getExpiryState(record) : { level: "incomplete" as const, label: "Нет данных", days: null };
        return { definition, record, state, isTyped };
      });
      return { person, aircraftType, operators: rowOperators, cells };
    }).filter((row) => !attentionOnly || row.cells.some((cell) => ["expired", "alert14", "alert45", "incomplete"].includes(cell.state.level)));

  return <section className="panel training-matrix-panel">
    <div className="panel-heading"><div><p className="eyebrow">Подготовка лётного состава</p><h2>Матрица подготовки</h2></div><div className="training-matrix-filters"><select value={operator} onChange={(event) => setOperator(event.target.value)}><option value="">Все эксплуатанты</option>{operators.map((item) => <option key={item}>{item}</option>)}</select><select value={aircraft} onChange={(event) => setAircraft(event.target.value)}><option value="">Все типы ВС</option>{aircraftTypes.map((item) => <option key={item}>{item}</option>)}</select><label><input type="checkbox" checked={attentionOnly} onChange={(event) => setAttentionOnly(event.target.checked)} /> Только требует внимания</label></div></div>
    <div className="training-matrix-legend"><span className="valid">Действует</span><span className="alert45">15–45 дней</span><span className="alert14">До 14 дней</span><span className="expired">Просрочено</span><span className="incomplete">Нет данных</span></div>
    <div className="training-matrix-scroll"><table className="training-matrix"><thead><tr><th>Сотрудник / тип ВС</th>{columns.map((item) => <th key={item.id}>{item.name}</th>)}</tr></thead><tbody>{rows.map(({ person, aircraftType, operators: rowOperators, cells }) => <tr key={`${person.id}-${aircraftType}`}><th><button onClick={() => onOpenPerson(person.id)}>{person.name}</button><strong className="training-aircraft-type">{aircraftType || "Тип ВС не указан"}</strong><small>{rowOperators.join(", ") || "Эксплуатант не указан"}</small></th>{cells.map(({ definition, record, state, isTyped }) => {
      const date = suggestionDate(record?.endDate ?? "");
      const planned = busyEntries.some((entry) => entry.personId === person.id && entry.activity === "periodic_training" && date >= entry.dateFrom && date <= entry.dateTo);
      return <td className={state.level} key={definition.id}><strong>{state.label}</strong><span>{record ? displayDate(record.endDate) : "Документ не внесён"}</span>{!isTyped && <small className="training-common-mark">Общая подготовка</small>}{["expired", "alert14", "alert45"].includes(state.level) && <button disabled={planned} onClick={() => { const note = `${definition.name}${isTyped && aircraftType ? ` · ${aircraftType}` : ""}`; onPlan({ id: uid(), personId: person.id, activity: "periodic_training", dateFrom: date, dateTo: date, note }); onNotify(planned ? "Подготовка уже запланирована" : `Подготовка предложена на ${displayDate(date)}`); }}>{planned ? "В плане" : `В план: ${displayDate(date)}`}</button>}</td>;
    })}</tr>)}</tbody></table></div>
  </section>;
}
