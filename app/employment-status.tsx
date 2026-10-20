"use client";

import { FormEvent, useState } from "react";
import type { EmploymentEvent, EmploymentPerson } from "./employment-rules";

const displayDate = (date: string) => new Intl.DateTimeFormat("ru-RU").format(new Date(`${date}T12:00:00`));
const todayDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export function EmploymentHistory({ history }: { history?: EmploymentEvent[] }) {
  if (!history?.length) return null;
  return <details className="employment-history"><summary>История приёма и увольнения · {history.length}</summary><ol>{[...history].reverse().map((event) => <li key={event.id}><strong>{event.kind === "dismissed" ? "Уволен" : "Принят повторно"} · {displayDate(event.date)}</strong><span>{event.orderNumber ? `Приказ № ${event.orderNumber}` : "Номер приказа не указан"}</span></li>)}</ol></details>;
}

export function EmploymentStatusDialog({ person, onClose, onConfirm }: {
  person: EmploymentPerson & { id: string; name: string };
  onClose: () => void;
  onConfirm: (event: Omit<EmploymentEvent, "id" | "recordedAt">) => void;
}) {
  const [date, setDate] = useState(todayDate);
  const [orderNumber, setOrderNumber] = useState("");
  const [error, setError] = useState("");
  const title = person.active ? "Увольнение и перевод в архив" : "Повторный приём сотрудника";
  function submit(event: FormEvent) {
    event.preventDefault();
    try { onConfirm({ kind: person.active ? "dismissed" : "rehired", date, orderNumber }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось изменить статус сотрудника."); }
  }
  return <div className="modal-backdrop employment-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="employment-title"><header><div><p className="eyebrow">Сотрудники</p><h2 id="employment-title">{title}</h2><span>{person.name}</span></div><button className="modal-close" aria-label="Закрыть" onClick={onClose}>×</button></header><form className="form-stack" onSubmit={submit}>
    <div className="report-scope-note">{person.active ? "Личное дело, документы, налёт, смены и прежние планы сохранятся. Сотрудник будет исключён из новых назначений и текущих предупреждений. Если есть будущие назначения, замените сотрудника в плане." : "Вернётся эта же карточка со всей историей. Перед назначением проверьте сроки документов и допуски к полётам."}</div>
    <label className="field"><span>{person.active ? "Дата увольнения" : "Дата повторного приёма"}</span><input autoFocus required type="date" min={person.employmentHistory?.at(-1)?.date} max={todayDate()} value={date} onChange={(event) => setDate(event.target.value)} /></label>
    <label className="field"><span>Номер приказа — необязательно</span><input value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} maxLength={120} /></label>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="form-actions"><button className="secondary-button" type="button" onClick={onClose}>Отмена</button><button className="primary-button" type="submit">{person.active ? "Уволить / В архив" : "Принять повторно"}</button></div>
  </form></section></div>;
}
