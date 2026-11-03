"use client";

import { useEffect, useMemo, useState } from "react";
import { workTimeDashboardRows } from "./work-time-dashboard-rules";
import type { WorkTimeDashboardInput, WorkTimeDashboardRow } from "./work-time-dashboard-rules";

function duration(minutes: number): string {
  return `${Math.floor(minutes / 60)} ч ${String(Math.round(minutes % 60)).padStart(2, "0")} мин`;
}

function boundary(value: number): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(value);
}

function status(row: WorkTimeDashboardRow): string {
  if (row.restKind === "weekly") return "Нужен еженедельный отдых";
  if (row.restKind === "split") return "Нужен отдых после разделённых смен";
  if (row.onDuty) return "Смена ещё не завершена";
  if (row.restKind === "daily") return "Идёт ежедневный отдых";
  if (row.daysUntilWeeklyRest === null) return "Недостаточно данных для расчёта отдыха";
  if (row.daysUntilWeeklyRest <= 3) return `До еженедельного отдыха: ${row.daysUntilWeeklyRest} раб. дн.`;
  if (row.cycleDays === 0) return "Еженедельный отдых завершён";
  return "Отдых после последней смены завершён";
}

export function WorkTimeDashboard({ people, input, onOpenJournal }: {
  people: { id: string; name: string; active: boolean }[];
  input: WorkTimeDashboardInput;
  onOpenJournal: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [tab, setTab] = useState<"attention" | "all">("attention");
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  const rows = useMemo(() => workTimeDashboardRows(people, input, now), [people, input, now]);
  const attention = rows.filter((row) => row.severity !== "normal");
  const selected = tab === "all" ? rows : attention;
  const visible = expanded ? selected : selected.slice(0, 5);
  return <section className="panel work-time-panel" aria-labelledby="work-time-title">
    <div className="insight-heading"><div><p className="eyebrow">Режим труда</p><h2 id="work-time-title">Рабочее время и отдых</h2></div><button type="button" className="link-button" onClick={onOpenJournal}>Открыть журнал →</button></div>
    <div className="work-time-toolbar"><div role="tablist" aria-label="Рабочее время сотрудников">
      <button type="button" role="tab" id="work-time-attention" aria-controls="work-time-rows" aria-selected={tab === "attention"} onClick={() => { setTab("attention"); setExpanded(false); }}>Требуют внимания <span>{attention.length}</span></button>
      <button type="button" role="tab" id="work-time-all" aria-controls="work-time-rows" aria-selected={tab === "all"} onClick={() => { setTab("all"); setExpanded(false); }}>Все сотрудники <span>{rows.length}</span></button>
    </div><span>За месяц · последние 7 дней</span></div>
    <div id="work-time-rows" role="tabpanel" aria-labelledby={tab === "all" ? "work-time-all" : "work-time-attention"}>
      {!visible.length ? <div className="good-state"><span>✓</span><div><strong>{rows.length ? "Нет уведомлений по рабочему времени" : "Нет действующих сотрудников"}</strong><p>{rows.length ? "Объём работы каждого сотрудника — во вкладке «Все сотрудники»." : "Добавьте сотрудника, чтобы начать учёт."}</p></div></div> : visible.map((row) => <article className={`work-time-row ${row.severity}`} key={row.id}>
        <div className="work-time-person"><i aria-hidden="true">{row.severity === "danger" ? "!" : row.severity === "warning" ? "◷" : "✓"}</i><div><strong>{row.name}</strong><small>{row.daysUntilWeeklyRest === null ? "Нет смен с указанным временем" : `Рабочих дней после отдыха: ${row.cycleDays}`}</small></div></div>
        <div className="work-time-hours"><strong>{duration(row.monthMinutes)}</strong><small>за месяц · {duration(row.sevenDayMinutes)} за 7 дней</small></div>
        <div className="work-time-status"><strong>{status(row)}</strong>
          {row.restUntil !== null && <small>{row.onDuty ? "После смены: " : ""}{duration(row.requiredRestMinutes)} отдыха · до {boundary(row.restUntil)}</small>}
          {row.restKind === "daily" && row.daysUntilWeeklyRest !== null && row.daysUntilWeeklyRest <= 3 && <small>До еженедельного отдыха: {row.daysUntilWeeklyRest} раб. дн.</small>}
          {row.hasUntimedWork && <small>Есть часы без времени начала: отдых по ним не рассчитан.</small>}
          {row.issues.length > 0 && <small className="work-time-violation">{new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(new Date(`${row.issues[0].date}T12:00:00`))}: {row.issues[0].kind === "daily" ? "ежедневный отдых" : row.issues[0].kind === "weekly" ? "еженедельный отдых" : "отдых после разделённых смен"} — {duration(row.issues[0].actualMinutes)} при норме {duration(row.issues[0].requiredMinutes)}{row.issues.length > 1 ? ` · ещё замечаний: ${row.issues.length - 1}` : ""}</small>}
        </div>
      </article>)}
    </div>
    <div className="work-time-footer"><small>По записям журнала на {boundary(now.getTime())}. Плановые смены не учитываются.</small>{selected.length > 5 && <button type="button" className="link-button" onClick={() => setExpanded(!expanded)}>{expanded ? "Свернуть" : `Показать всех (${selected.length})`}</button>}</div>
  </section>;
}
