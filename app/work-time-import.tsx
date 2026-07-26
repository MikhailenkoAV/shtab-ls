"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import {
  buildWorkTimeImport,
  ImportedWorkTimeShift,
  mergeImportedWorkTime,
  WorkTimeImportPerson,
  WorkTimeImportResult,
  WorkTimeSheetInput,
} from "./work-time-import-rules";

export function WorkTimeImportModal({
  people,
  shifts,
  onClose,
  onSubmit,
}: {
  people: WorkTimeImportPerson[];
  shifts: ImportedWorkTimeShift[];
  onClose: () => void;
  onSubmit: (records: ImportedWorkTimeShift[]) => void;
}) {
  const [dateFrom, setDateFrom] = useState("2026-07-01");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<WorkTimeImportResult | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const mergePreview = useMemo(() => parsed ? mergeImportedWorkTime(shifts, parsed.records) : null, [parsed, shifts]);

  async function parseFile(file: File, from: string) {
    setReading(true);
    setError("");
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const sheets: WorkTimeSheetInput[] = workbook.SheetNames.flatMap((name) => {
        if (name === "90 дней") return [];
        const sheet = workbook.Sheets[name];
        if (!sheet) return [];
        return [{
          name,
          rows: XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null }),
          merges: (sheet["!merges"] ?? []).map((merge) => ({
            s: { r: merge.s.r, c: merge.s.c },
            e: { r: merge.e.r, c: merge.e.c },
          })),
        }];
      });
      const result = buildWorkTimeImport(sheets, people, from);
      if (!result.sourcePeople.length) throw new Error("В книге не найдены листы рабочего времени.");
      setParsed(result);
    } catch (caught) {
      setParsed(null);
      setError(caught instanceof Error ? caught.message : "Не удалось прочитать книгу Excel.");
    } finally {
      setReading(false);
    }
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setSourceFile(file);
    await parseFile(file, dateFrom);
    event.target.value = "";
  }

  function changeDate(value: string) {
    setDateFrom(value);
    if (sourceFile && value) void parseFile(sourceFile, value);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!parsed || !mergePreview || !mergePreview.addedRows) return;
    onSubmit(parsed.records);
  }

  const issueCounts = parsed?.issues.reduce((result, issue) => {
    result[issue.kind] += 1;
    return result;
  }, { unmatched: 0, qualification: 0, seat: 0, aircraft: 0 });

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal wide work-import-modal" role="dialog" aria-modal="true" aria-labelledby="work-import-title">
      <header><div><p className="eyebrow">Полётные смены</p><h2 id="work-import-title">Импорт рабочего времени</h2><span>Предварительная проверка перед добавлением записей в Единый журнал</span></div><button className="modal-close" aria-label="Закрыть" onClick={onClose}>×</button></header>
      <form className="form-stack" onSubmit={submit}>
        <div className="form-grid two">
          <label className="field"><span>Начальная дата</span><input required type="date" value={dateFrom} onChange={(event) => changeDate(event.target.value)} /></label>
          <div className="work-import-source"><span>Файл</span><strong>{sourceFile?.name ?? "Не выбран"}</strong><small>Повторный импорт не создаёт одинаковые записи.</small></div>
        </div>
        <label className="file-drop"><input hidden type="file" accept=".xlsx,.xls" onChange={readFile} /><span>{reading ? "Проверяю книгу…" : sourceFile ? "Выбрать другой Excel" : "Выбрать Excel с рабочим временем"}</span><small>Данные обрабатываются только в браузере на этом устройстве</small></label>
        {error && <div className="import-error">{error}</div>}
        {parsed && mergePreview && <>
          <div className="import-summary work-import-summary">
            <div><strong>{parsed.sourcePeople.length}</strong><span>сотрудников в книге</span></div>
            <div><strong>{parsed.matchedPeople.length}</strong><span>сопоставлено</span></div>
            <div><strong>{parsed.flightSegments}</strong><span>полётных записей</span></div>
            <div><strong>{mergePreview.addedRows}</strong><span>будет добавлено</span></div>
          </div>
          <div className="work-import-period"><strong>{parsed.dateFrom}</strong><span>—</span><strong>{parsed.dateTo || "нет заполненных записей"}</strong><small>Неполётных записей: {parsed.nonFlightRecords} · найденных дублей: {mergePreview.duplicateRows}</small></div>
          <div className="work-import-statuses">
            <span className={parsed.unmatchedRows ? "danger" : "ok"}>Несопоставленных строк: {parsed.unmatchedRows}</span>
            <span className={issueCounts?.qualification ? "warning" : "ok"}>Допуски: {issueCounts?.qualification ?? 0}</span>
            <span className={parsed.uncertainSeats ? "warning" : "ok"}>Кресло «КВС» по умолчанию: {parsed.uncertainSeats}</span>
            <span className={issueCounts?.aircraft ? "danger" : "ok"}>Неизвестные борта: {issueCounts?.aircraft ?? 0}</span>
          </div>
          {parsed.issues.length > 0 && <div className="work-import-issues"><div className="section-label"><strong>Требует проверки</strong><span>{parsed.issues.length}</span></div><ul>{parsed.issues.slice(0, 12).map((issue) => <li key={`${issue.kind}-${issue.text}`} className={issue.kind}>{issue.text}</li>)}</ul>{parsed.issues.length > 12 && <small>И ещё {parsed.issues.length - 12} замечаний.</small>}</div>}
          <div className="import-note"><strong>Правила импорта</strong><span>Объединённые ячейки разворачиваются автоматически; несколько полётов одного сотрудника за дату объединяются в одну смену. Кресло определяется по примечанию и допускам, иначе используется «КВС». Месячный план не изменяется.</span></div>
        </>}
        <div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button" disabled={!parsed || !mergePreview || !mergePreview.addedRows}>{reading ? "Проверяю…" : mergePreview?.addedRows ? "Добавить в журнал" : "Нет новых записей"}</button></div>
      </form>
    </section>
  </div>;
}
