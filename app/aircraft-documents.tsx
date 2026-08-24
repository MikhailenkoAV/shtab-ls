"use client";

import { useMemo, useState } from "react";
import { aircraftNumbersByType } from "./aircraft-rules";
import {
  activeAircraftDocument,
  aircraftDocumentDefinitions,
  aircraftDocumentState,
  AircraftDocumentDefinition,
  AircraftDocumentOperation,
  AircraftDocumentRecord,
  AircraftDocumentScope,
} from "./aircraft-documents-rules";

type AircraftDocumentPerson = { id: string; name: string; aircraftTypes: string[]; active: boolean };
type AircraftDocumentCertification = { personId: string; aircraftType: string; certificationType: string; endDate: string };
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const formatDate = (value: string) => value ? new Intl.DateTimeFormat("ru-RU").format(new Date(`${value}T12:00:00`)) : "бессрочно";

export function AircraftDocumentsView({ records, people, certifications, onSave, onDelete }: {
  records: AircraftDocumentRecord[];
  people: AircraftDocumentPerson[];
  certifications: AircraftDocumentCertification[];
  onSave: (record: AircraftDocumentRecord, replaceId?: string) => void;
  onDelete: (recordId: string) => void;
}) {
  const aircraft = useMemo(() => Object.entries(aircraftNumbersByType).flatMap(([type, numbers]) => numbers.map((number) => ({ number, type }))), []);
  const [selectedAircraft, setSelectedAircraft] = useState(aircraft[0]?.number ?? "");
  const [operation, setOperation] = useState<AircraftDocumentOperation>("КВП");
  const [editing, setEditing] = useState<{ definition: AircraftDocumentDefinition; record?: AircraftDocumentRecord } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const selected = aircraft.find((item) => item.number === selectedAircraft) ?? aircraft[0];
  const definitions = [...aircraftDocumentDefinitions(operation, "permanent"), ...aircraftDocumentDefinitions(operation, "flight")];
  const complete = definitions.filter((definition) => activeAircraftDocument(records, selectedAircraft, operation, definition.id)).length;
  const crew = people.filter((person) => person.active && person.aircraftTypes.includes(selected?.type ?? ""));
  const archived = records.filter((item) => item.aircraft === selectedAircraft && item.operation === operation && item.archivedAt)
    .sort((left, right) => right.archivedAt.localeCompare(left.archivedAt));

  return <section className="aircraft-documents-stack">
    <article className="panel documentation-workspace">
      <div className="panel-heading"><div><p className="eyebrow">Судовая документация</p><h2>Комплектность документов по борту</h2></div><button className="secondary-button compact" onClick={() => setHistoryOpen((value) => !value)}>История {archived.length ? `· ${archived.length}` : ""}</button></div>
      <div className="aircraft-document-toolbar">
        <label className="field"><span>Бортовой номер</span><select value={selectedAircraft} onChange={(event) => setSelectedAircraft(event.target.value)}>{aircraft.map((item) => <option key={item.number} value={item.number}>{item.number} · {item.type}</option>)}</select></label>
        <label className="field"><span>Эксплуатант</span><select value={operation} onChange={(event) => setOperation(event.target.value as AircraftDocumentOperation)}><option>КВП</option><option>АОН</option></select></label>
        <div className="aircraft-document-summary"><strong>{complete} / {definitions.length}</strong><span>документов отмечено</span></div>
      </div>
      <div className="report-scope-note">Международные полёты не учитываются. Необязательные документы отмечены пояснением и не блокируют ведение журнала.</div>
    </article>

    {historyOpen && <article className="panel documentation-workspace aircraft-document-history">
      <div className="panel-heading"><div><p className="eyebrow">Архив</p><h2>История замен и удалений</h2></div></div>
      {!archived.length ? <div className="panel-empty">Для выбранного борта история пока пуста.</div> : <div className="table-scroll"><table className="registry-table"><thead><tr><th>Документ</th><th>Номер</th><th>Действовал до</th><th>Архивирован</th></tr></thead><tbody>{archived.map((record) => <tr key={record.id}><td>{record.title}</td><td>{record.number || "—"}</td><td>{formatDate(record.expiryDate)}</td><td>{formatDate(record.archivedAt.slice(0, 10))}</td></tr>)}</tbody></table></div>}
    </article>}

    {(["permanent", "flight"] as AircraftDocumentScope[]).map((scope) => <article className="panel documentation-workspace" key={scope}>
      <div className="panel-heading"><div><p className="eyebrow">{scope === "permanent" ? "На борту" : "На конкретный полёт"}</p><h2>{scope === "permanent" ? "Постоянный комплект" : "Оперативные документы"}</h2></div></div>
      <div className="aircraft-document-list">{aircraftDocumentDefinitions(operation, scope).map((definition) => {
        const record = activeAircraftDocument(records, selectedAircraft, operation, definition.id);
        const state = aircraftDocumentState(record);
        return <article className={`aircraft-document-row state-${state}`} key={definition.id}>
          <div className="aircraft-document-state" aria-label={state}>{state === "valid" ? "✓" : state === "warning" ? "!" : state === "expired" ? "×" : "—"}</div>
          <div><strong>{definition.title}</strong>{definition.note && <small>{definition.note}</small>}{record && <small>№ {record.number || "не указан"} · до {formatDate(record.expiryDate)} · {record.storagePlace || "место не указано"}</small>}</div>
          <button className="row-action" onClick={() => setEditing({ definition, record })}>{record ? "Изменить / заменить" : "Добавить"}</button>
        </article>;
      })}</div>
    </article>)}

    <article className="panel documentation-workspace">
      <div className="panel-heading"><div><p className="eyebrow">Экипаж</p><h2>Документы членов экипажа</h2></div><span className="settings-auto-save">из личных дел</span></div>
      {!crew.length ? <div className="panel-empty">Нет активных сотрудников с типом {selected?.type}.</div> : <div className="aircraft-crew-document-list">{crew.map((person) => {
        const personDocs = certifications.filter((item) => item.personId === person.id && (!item.aircraftType || item.aircraftType === selected?.type));
        const warnings = personDocs.filter((item) => item.endDate && aircraftDocumentState({ expiryDate: item.endDate } as AircraftDocumentRecord) !== "valid").length;
        return <div key={person.id}><strong>{person.name}</strong><span>{personDocs.length} документов{warnings ? ` · требуют внимания: ${warnings}` : " · без ближайших сроков"}</span></div>;
      })}</div>}
    </article>

    {editing && <AircraftDocumentModal aircraft={selected?.number ?? ""} aircraftType={selected?.type ?? ""} operation={operation} definition={editing.definition} record={editing.record} onClose={() => setEditing(null)} onSave={(record, replaceId) => { onSave(record, replaceId); setEditing(null); }} onDelete={editing.record ? () => { onDelete(editing.record!.id); setEditing(null); } : undefined} />}
  </section>;
}

function AircraftDocumentModal({ aircraft, aircraftType, operation, definition, record, onClose, onSave, onDelete }: {
  aircraft: string; aircraftType: string; operation: AircraftDocumentOperation; definition: AircraftDocumentDefinition;
  record?: AircraftDocumentRecord; onClose: () => void; onSave: (record: AircraftDocumentRecord, replaceId?: string) => void; onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<AircraftDocumentRecord>(() => record ? { ...record } : { id: uid(), definitionId: definition.id, title: definition.title, aircraft, aircraftType, operation, scope: definition.scope, number: "", issueDate: todayIso(), expiryDate: "", storagePlace: "На борту", medium: "paper", note: "", createdAt: new Date().toISOString(), archivedAt: "" });
  const patch = (value: Partial<AircraftDocumentRecord>) => setDraft((current) => ({ ...current, ...value }));
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal wide">
    <header><div><h2>{record ? "Изменить или заменить документ" : "Добавить документ"}</h2><span>{aircraft} · {operation} · {definition.title}</span></div><button className="modal-close" onClick={onClose}>×</button></header>
    <form onSubmit={(event) => { event.preventDefault(); onSave({ ...draft, id: record ? uid() : draft.id, createdAt: new Date().toISOString(), archivedAt: "" }, record?.id); }}>
      <div className="form-grid two">
        <label className="field"><span>Серия / номер</span><input value={draft.number} onChange={(event) => patch({ number: event.target.value })} /></label>
        <label className="field"><span>Место хранения</span><input value={draft.storagePlace} onChange={(event) => patch({ storagePlace: event.target.value })} placeholder="На борту, папка…" /></label>
        <label className="field"><span>Дата выдачи</span><input type="date" value={draft.issueDate} onChange={(event) => patch({ issueDate: event.target.value })} /></label>
        <label className="field"><span>Действителен до</span><input type="date" value={draft.expiryDate} onChange={(event) => patch({ expiryDate: event.target.value })} /></label>
        <label className="field"><span>Носитель</span><select value={draft.medium} onChange={(event) => patch({ medium: event.target.value as AircraftDocumentRecord["medium"] })}><option value="paper">Бумажный</option><option value="electronic">Электронный</option><option value="both">Бумажный и электронный</option></select></label>
        <label className="field"><span>Примечание</span><input value={draft.note} onChange={(event) => patch({ note: event.target.value })} /></label>
      </div>
      <div className="modal-actions">{onDelete && <button type="button" className="danger-button" onClick={onDelete}>Удалить</button>}<button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button className="primary-button" type="submit">{record ? "Сохранить новую версию" : "Добавить"}</button></div>
    </form>
  </section></div>;
}
