"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { WorkspaceConflict } from "./cloud-sync";
import { backupRestoreSummary, sectionLabels } from "./recovery-rules";

function SafetyDialog({ title, children }: { title: string; children: React.ReactNode }) {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="modal-backdrop safety-backdrop"><section ref={ref} tabIndex={-1} className="modal wide safety-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={(event) => {
    if (event.key !== "Tab") return;
    const controls = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])];
    const first = controls[0]; const last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first?.focus(); }
  }}><header><div><p className="eyebrow">Защита данных</p><h2 id={titleId}>{title}</h2></div></header>{children}</section></div>;
}

export function BackupPreviewDialog({ filename, current, restored, busy, error, onCancel, onConfirm }: {
  filename: string; current: Record<string, unknown>; restored: Record<string, unknown>; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void;
}) {
  const changes = backupRestoreSummary(current, restored);
  return <SafetyDialog title="Проверка перед восстановлением"><div className="safety-dialog-body">
    <p className="safety-filename">Файл: <strong>{filename}</strong></p>
    <div className="report-scope-note">Восстановление заменит текущую базу содержимым файла и отправит изменения в облако. До замены будет сохранена контрольная точка текущей базы.</div>
    {changes.length ? <div className="table-scroll"><table className="backup-preview-table"><thead><tr><th>Раздел</th><th>Сейчас → в файле</th><th>Изменения</th></tr></thead><tbody>{changes.map((item) => <tr key={item.key}><td>{item.label}</td><td>{item.beforeCount ?? "—"} → {item.afterCount ?? "—"}</td><td>{item.added !== null ? `Добавится: ${item.added}; изменится: ${item.changed}; уберётся: ${item.removed}` : "Изменятся настройки"}</td></tr>)}</tbody></table></div> : <p>Содержимое файла совпадает с текущей базой. Восстановление не требуется.</p>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="form-actions"><button className="secondary-button" disabled={busy} onClick={onCancel}>Отмена</button><button className="primary-button" disabled={busy || !changes.length} onClick={onConfirm}>{busy ? "Сохраняю контрольную точку…" : "Подтверждаю замену базы"}</button></div>
  </div></SafetyDialog>;
}

const fieldLabels: Record<string, string> = { name: "ФИО", note: "Примечание", date: "Дата", endDate: "Окончание срока", issuedDate: "Дата выдачи", aircraft: "Борт", aircraftType: "Тип ВС", flightMinutes: "Полётное время (мин)", nightMinutes: "Ночной налёт (мин)", dayLandings: "Посадки днём", nightLandings: "Посадки ночью", dutyStart: "Начало смены", dutyEnd: "Конец смены", operators: "Эксплуатанты", operator: "Эксплуатант", monthlyPlanEnabled: "Участие в месячном плане", certificationType: "Вид документа", number: "Номер", active: "Активен" };
function conflictTitle(conflict: WorkspaceConflict, workspace: Record<string, unknown>) {
  const parts: string[] = [];
  let current: unknown = workspace;
  for (const part of conflict.path) {
    if ("key" in part) { parts.push(sectionLabels[part.key] ?? fieldLabels[part.key] ?? part.key); current = (current as Record<string, unknown> | undefined)?.[part.key]; }
    else {
      const record = Array.isArray(current) ? current.find((item) => item.id === part.id) : undefined;
      const value = record ?? (typeof conflict.remote === "object" ? conflict.remote : conflict.local) as Record<string, unknown> | null;
      parts.push(String(value?.name ?? value?.number ?? value?.date ?? part.id));
      current = record;
    }
  }
  return parts.join(" · ");
}
function valueText(value: unknown, present: boolean) {
  if (!present) return "Запись удалена";
  if (value === "" || value === null || value === undefined) return "Не заполнено";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

export function SyncConflictDialog({ conflicts, workspace, onConfirm }: { conflicts: WorkspaceConflict[]; workspace: Record<string, unknown>; onConfirm: (choices: Record<string, "local" | "remote">) => void }) {
  const [choices, setChoices] = useState<Record<string, "local" | "remote">>({});
  const complete = conflicts.every((conflict) => choices[conflict.id]);
  return <SafetyDialog title="Выберите версии изменённых данных"><div className="safety-dialog-body">
    <div className="report-scope-note">На двух устройствах изменены одни и те же данные. Отправка в облако приостановлена. Независимые изменения будут объединены; для каждого конфликта выберите нужное значение.</div>
    <div className="sync-conflict-list">{conflicts.map((conflict) => <fieldset className="sync-conflict" key={conflict.id}><legend>{conflictTitle(conflict, workspace)}</legend><div className="sync-conflict-options">{(["local", "remote"] as const).map((side) => <label key={side} className={choices[conflict.id] === side ? "selected" : ""}><span><input type="radio" name={conflict.id} checked={choices[conflict.id] === side} onChange={() => setChoices((current) => ({ ...current, [conflict.id]: side }))} />{side === "local" ? "На этом устройстве" : "В облаке"}</span><pre>{valueText(conflict[side], conflict[`${side}Present`])}</pre></label>)}</div></fieldset>)}</div>
    <div className="form-actions"><span className="safety-choice-count">Выбрано {Object.keys(choices).length} из {conflicts.length}</span><button className="primary-button" disabled={!complete} onClick={() => onConfirm(choices)}>Применить выбранные версии</button></div>
  </div></SafetyDialog>;
}
