"use client";
/* eslint-disable @next/next/no-img-element -- previews are generated locally from the selected PDF */

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { aircraftNumbersForType, canonicalAircraftType } from "./aircraft-rules";
import type {
  FlightTaskDraft,
  FlightTaskLegDraft,
} from "./flight-task-import-rules";
import { buildFlightTaskOcr, normalizedClock, sumFlightTaskLegs } from "./flight-task-import-rules";
import type { ImportedWorkTimeShift, WorkTimeImportPerson } from "./work-time-import-rules";

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const durationText = (minutes: number) => `${String(Math.floor(Math.max(0, minutes) / 60)).padStart(2, "0")}:${String(Math.max(0, minutes) % 60).padStart(2, "0")}`;
const parseDuration = (value: string) => {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
};

async function renderPdfPages(file: File, onProgress: (message: string) => void) {
  onProgress("Открываю PDF…");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  if (pdf.numPages < 2) throw new Error("В документе не найдена вторая страница «Отчёт о рейсе».");
  const canvases: HTMLCanvasElement[] = [];
  for (const pageNumber of [1, 2]) {
    onProgress(`Подготавливаю страницу ${pageNumber} из 2…`);
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2.15 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Браузер не смог подготовить страницу для распознавания.");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    canvases.push(canvas);
  }
  return canvases;
}

type NormalizedRect = { x: number; y: number; width: number; height: number };

function isolatedCells(source: HTMLCanvasElement, cells: NormalizedRect[], direction: "row" | "column") {
  const cellWidth = 280;
  const cellHeight = 110;
  const gap = 36;
  const canvas = document.createElement("canvas");
  canvas.width = direction === "row" ? cells.length * cellWidth + Math.max(0, cells.length - 1) * gap : cellWidth;
  canvas.height = direction === "column" ? cells.length * cellHeight + Math.max(0, cells.length - 1) * gap : cellHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Не удалось подготовить ячейки отчёта.");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  cells.forEach((cell, index) => {
    const sx = Math.round(source.width * cell.x);
    const sy = Math.round(source.height * cell.y);
    const sw = Math.round(source.width * cell.width);
    const sh = Math.round(source.height * cell.height);
    const dx = direction === "row" ? index * (cellWidth + gap) : 0;
    const dy = direction === "column" ? index * (cellHeight + gap) : 0;
    context.drawImage(source, sx, sy, sw, sh, dx, dy, cellWidth, cellHeight);
  });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const gray = image.data[index] * .299 + image.data[index + 1] * .587 + image.data[index + 2] * .114;
    const value = gray < 205 ? 0 : 255;
    image.data[index] = value; image.data[index + 1] = value; image.data[index + 2] = value;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function numberTokens(value: string): string[] {
  return value.replace(/[OoОо]/g, "0").match(/\d{1,4}(?:[.:,]\d{1,2})?/g) ?? [];
}

async function recognizeFlightTask(file: File, people: WorkTimeImportPerson[], onProgress: (message: string, percent: number) => void) {
  const canvases = await renderPdfPages(file, (message) => onProgress(message, 5));
  const { createWorker, PSM } = await import("tesseract.js");
  onProgress("Загружаю русский модуль распознавания…", 10);
  const worker = await createWorker(["rus", "eng"], 1, {
    logger: (message) => {
      if (message.status === "recognizing text") onProgress("Распознаю рукописные и печатные поля…", 15 + Math.round((message.progress ?? 0) * 75));
    },
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    onProgress("Читаю реквизиты полётного задания…", 20);
    const page1 = await worker.recognize(canvases[0]);
    onProgress("Читаю отчёт о рейсе…", 55);
    const page2 = await worker.recognize(canvases[1]);
    onProgress("Уточняю рукописные значения в ячейках…", 82);
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789.:,",
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    });
    const summaryCells = isolatedCells(canvases[1], [
      { x: .098, y: .566, width: .034, height: .033 },
      { x: .133, y: .566, width: .038, height: .033 },
      { x: .515, y: .566, width: .045, height: .033 },
      { x: .638, y: .566, width: .039, height: .033 },
    ], "row");
    const summaryOcr = await worker.recognize(summaryCells);
    const summary = numberTokens(summaryOcr.data.text);
    const legCells = isolatedCells(canvases[1], Array.from({ length: 10 }, (_, index) => ({
      x: .520, y: .193 + index * .0242, width: .039, height: .021,
    })), "column");
    const legsOcr = await worker.recognize(legCells);
    const legFlights = numberTokens(legsOcr.data.text).filter((value) => value !== "0" && value !== "00");
    onProgress("Сопоставляю данные с журналом…", 95);
    return {
      result: buildFlightTaskOcr({
        page1: page1.data.text,
        page2: page2.data.text,
        fileName: file.name,
        hints: {
          dutyStart: summary[0], dutyEnd: summary[1], totalFlight: summary[2], landings: summary[3], legFlights,
        },
      }, people),
      previews: canvases.map((canvas) => canvas.toDataURL("image/jpeg", 0.86)),
    };
  } finally {
    await worker.terminate();
  }
}

function emptyDraft(): FlightTaskDraft {
  return {
    personId: "", personText: "", date: "", dutyStart: "", dutyEnd: "", aircraftType: "", aircraft: "", purpose: "АОН", seat: "КВС",
    legs: [{ id: uid(), flightMinutes: 0, nightMinutes: 0, dayLandings: 0, nightLandings: 0 }], note: "",
  };
}

function intervalMinutes(start: string, end: string) {
  const [startHours, startMinutes] = start.split(":").map(Number);
  const [endHours, endMinutes] = end.split(":").map(Number);
  if (![startHours, startMinutes, endHours, endMinutes].every(Number.isFinite)) return 0;
  const from = startHours * 60 + startMinutes;
  const to = endHours * 60 + endMinutes;
  return to >= from ? to - from : 1_440 - from + to;
}

export function FlightTaskImportModal({ people, onClose, onSubmit }: {
  people: WorkTimeImportPerson[];
  onClose: () => void;
  onSubmit: (records: ImportedWorkTimeShift[]) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [activePage, setActivePage] = useState(1);
  const [draft, setDraft] = useState<FlightTaskDraft>(emptyDraft);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [recognizedFields, setRecognizedFields] = useState(0);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const person = people.find((item) => item.id === draft.personId);
  const availableTypes = useMemo(() => [...new Set([...(person?.aircraftTypes ?? []), draft.aircraftType].filter(Boolean))].sort(), [person, draft.aircraftType]);
  const availableNumbers = aircraftNumbersForType(draft.aircraftType);
  const totals = useMemo(() => sumFlightTaskLegs(draft.legs), [draft.legs]);

  useEffect(() => () => previewUrls.forEach((url) => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); }), [previewUrls]);

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    if (selected.type !== "application/pdf" && !selected.name.toLocaleLowerCase("ru-RU").endsWith(".pdf")) {
      setError("Выберите полётное задание в формате PDF."); return;
    }
    setFile(selected); setReading(true); setError(""); setWarnings([]); setProgress(0); setStatus("Подготавливаю документ…");
    try {
      const recognized = await recognizeFlightTask(selected, people, (message, percent) => { setStatus(message); setProgress(percent); });
      setDraft(recognized.result.draft);
      setWarnings(recognized.result.warnings);
      setRecognizedFields(recognized.result.recognizedFields);
      setPreviewUrls(recognized.previews);
      setActivePage(1);
      setProgress(100); setStatus("Черновик готов. Сверьте значения с документом.");
    } catch (caught) {
      setDraft((current) => ({ ...current, note: `Импортировано из полётного задания «${selected.name}». Проверено перед сохранением.` }));
      setPreviewUrls([URL.createObjectURL(selected)]);
      setError(`${caught instanceof Error ? caught.message : "Не удалось распознать документ."} Можно заполнить поля вручную по открытому PDF.`);
    } finally { setReading(false); }
  }

  function patchLeg(id: string, patch: Partial<FlightTaskLegDraft>) {
    setDraft((current) => ({ ...current, legs: current.legs.map((leg) => leg.id === id ? { ...leg, ...patch } : leg) }));
  }

  function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    const dutyStart = normalizedClock(draft.dutyStart);
    const dutyEnd = normalizedClock(draft.dutyEnd);
    if (!draft.personId || !draft.date || !dutyStart || !dutyEnd || !draft.aircraftType || !draft.aircraft || !draft.legs.length) {
      setError("Заполните сотрудника, дату, границы смены, тип ВС, борт и хотя бы один полёт."); return;
    }
    if (totals.nightMinutes > totals.flightMinutes) { setError("Ночной налёт не может превышать общее полётное время."); return; }
    const createdAt = new Date().toISOString();
    const shiftId = uid();
    const segments = draft.legs.map((leg) => ({
      id: leg.id || uid(), aircraft: draft.aircraft, aircraftType: canonicalAircraftType(draft.aircraftType), seat: draft.seat,
      purpose: draft.purpose, dutyStart, dutyEnd, flightMinutes: Math.max(0, leg.flightMinutes), nightMinutes: Math.max(0, leg.nightMinutes),
      dayLandings: Math.max(0, Math.floor(leg.dayLandings)), nightLandings: Math.max(0, Math.floor(leg.nightLandings)), splitShift: false,
    }));
    onSubmit([{ id: shiftId, personId: draft.personId, date: draft.date, activity: "flight", start: dutyStart,
      workMinutes: intervalMinutes(dutyStart, dutyEnd), segments, note: draft.note.trim(), createdAt }]);
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !reading) onClose(); }}>
    <section className="modal extra-wide flight-task-import-modal" role="dialog" aria-modal="true" aria-labelledby="flight-task-import-title">
      <header><div><p className="eyebrow">Полётные смены</p><h2 id="flight-task-import-title">Импорт полётного задания</h2><span>Распознавание «Отчёта о рейсе» с обязательной проверкой перед сохранением</span></div><button className="modal-close" disabled={reading} aria-label="Закрыть" onClick={onClose}>×</button></header>
      {!file ? <div className="flight-task-start"><label className="file-drop"><input hidden type="file" accept="application/pdf,.pdf" onChange={readFile} /><span>Выбрать полётное задание PDF</span><small>Обрабатываются первые две страницы. Документ не отправляется в базу и сторонние сервисы.</small></label><div className="import-note"><strong>Что будет заполнено</strong><span>Сотрудник, дата, начало и окончание смены, тип и борт ВС, цель, налёт, ночь и посадки. Результат сначала откроется как редактируемый черновик.</span></div></div> : <>
        {reading && <div className="flight-task-reading"><span className="sync-spinner" /><strong>{status}</strong><progress max="100" value={progress} /><small>{progress}% · скорость зависит от компьютера и качества скана</small></div>}
        {!reading && <form className="flight-task-review" onSubmit={submit}>
          <aside className="flight-task-preview"><div className="flight-task-page-tabs"><button type="button" className={activePage === 0 ? "active" : ""} onClick={() => setActivePage(0)}>Задание</button><button type="button" className={activePage === 1 ? "active" : ""} onClick={() => setActivePage(1)}>Отчёт о рейсе</button></div>{previewUrls.length > 1 ? <img src={previewUrls[activePage] ?? previewUrls[0]} alt={activePage ? "Страница Отчёт о рейсе" : "Первая страница полётного задания"} /> : previewUrls[0] ? <object data={previewUrls[0]} type="application/pdf" aria-label="Полётное задание" /> : null}</aside>
          <div className="flight-task-fields">
            <div className="flight-task-confidence"><div><strong>Распознано полей: {recognizedFields} из 8</strong><span>{warnings.length ? `Требует проверки: ${warnings.length}` : "Основные поля найдены"}</span></div><label className="file-replace"><input hidden type="file" accept="application/pdf,.pdf" onChange={readFile} />Выбрать другой PDF</label></div>
            {warnings.length > 0 && <div className="work-import-issues"><div className="section-label"><strong>Проверьте значения</strong><span>{warnings.length}</span></div><ul>{warnings.map((warning) => <li className="seat" key={warning}>{warning}</li>)}</ul></div>}
            {error && <div className="import-error">{error}</div>}
            <div className="form-grid two"><label className="field"><span>Сотрудник</span><select required value={draft.personId} onChange={(event) => setDraft((current) => ({ ...current, personId: event.target.value }))}><option value="">Выберите сотрудника{draft.personText ? ` · найдено: ${draft.personText}` : ""}</option>{people.filter((item) => item.active).sort((a, b) => a.name.localeCompare(b.name, "ru-RU")).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="field"><span>Дата</span><input required type="date" value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} /></label></div>
            <div className="form-grid two"><label className="field"><span>Начало смены</span><input required value={draft.dutyStart} placeholder="06:00" onChange={(event) => setDraft((current) => ({ ...current, dutyStart: event.target.value }))} /></label><label className="field"><span>Окончание смены</span><input required value={draft.dutyEnd} placeholder="14:45" onChange={(event) => setDraft((current) => ({ ...current, dutyEnd: event.target.value }))} /></label></div>
            <div className="form-grid two"><label className="field"><span>Тип ВС</span><select required value={draft.aircraftType} onChange={(event) => setDraft((current) => ({ ...current, aircraftType: event.target.value, aircraft: "" }))}><option value="">Выберите тип ВС</option>{availableTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label className="field"><span>Бортовой №</span><select required value={draft.aircraft} onChange={(event) => setDraft((current) => ({ ...current, aircraft: event.target.value }))}><option value="">Выберите борт</option>{[...new Set([...availableNumbers, draft.aircraft].filter(Boolean))].map((number) => <option key={number}>{number}</option>)}</select></label></div>
            <div className="form-grid two"><label className="field"><span>Цель</span><select value={draft.purpose} onChange={(event) => setDraft((current) => ({ ...current, purpose: event.target.value }))}>{["КВП", "АОН", "АР", "АОН (УТП)"].map((purpose) => <option key={purpose}>{purpose}</option>)}</select></label><label className="field"><span>Кресло</span><select value={draft.seat} onChange={(event) => setDraft((current) => ({ ...current, seat: event.target.value as FlightTaskDraft["seat"] }))}><option>КВС</option><option>Пилот-инструктор</option></select></label></div>
            <div className="section-label"><strong>Полёты внутри смены</strong><button type="button" className="link-button" onClick={() => setDraft((current) => ({ ...current, legs: [...current.legs, { id: uid(), flightMinutes: 0, nightMinutes: 0, dayLandings: 0, nightLandings: 0 }] }))}>+ Добавить полёт</button></div>
            <div className="flight-task-legs">{draft.legs.map((leg, index) => <div className="flight-task-leg" key={leg.id}><strong>{index + 1}</strong><label><span>Полётное</span><input value={durationText(leg.flightMinutes)} onChange={(event) => patchLeg(leg.id, { flightMinutes: parseDuration(event.target.value) })} /></label><label><span>Ночь</span><input value={durationText(leg.nightMinutes)} onChange={(event) => patchLeg(leg.id, { nightMinutes: parseDuration(event.target.value) })} /></label><label><span>Посадки день</span><input type="number" min="0" value={leg.dayLandings} onChange={(event) => patchLeg(leg.id, { dayLandings: Number(event.target.value) })} /></label><label><span>Ночь</span><input type="number" min="0" value={leg.nightLandings} onChange={(event) => patchLeg(leg.id, { nightLandings: Number(event.target.value) })} /></label><button type="button" disabled={draft.legs.length === 1} aria-label="Удалить полёт" onClick={() => setDraft((current) => ({ ...current, legs: current.legs.filter((item) => item.id !== leg.id) }))}>×</button></div>)}</div>
            <div className="flight-task-totals"><span>Смена <strong>{draft.dutyStart || "—"}–{draft.dutyEnd || "—"}</strong></span><span>Налёт <strong>{durationText(totals.flightMinutes)}</strong></span><span>Ночь <strong>{durationText(totals.nightMinutes)}</strong></span><span>Посадки Д/Н <strong>{totals.dayLandings}/{totals.nightLandings}</strong></span></div>
            <label className="field"><span>Примечание</span><textarea value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} /></label>
            <div className="import-note"><strong>Подтверждение обязательно</strong><span>Проверьте каждое значение по изображению слева. Признаки «Разделённая смена» и «Вне базы» распознаванием не устанавливаются.</span></div>
            <div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button">Проверено, добавить в журнал</button></div>
          </div>
        </form>}
      </>}
    </section>
  </div>;
}
