import { activityUsesTime } from "./activity-rules.ts";
import {
  calculateRestIssues,
  DAILY_REST_MINUTES,
  SPLIT_REST_MINUTES,
  WEEKLY_REST_MINUTES,
} from "./rest-rules.ts";
import type { RestDayInput, RestIntervalInput, RestIssue } from "./rest-rules.ts";

export type WorkTimeRecord = {
  id: string;
  personId: string;
  date: string;
  activity: string;
  workMinutes: number;
  startTime: number | null;
};

export type WorkTimeDashboardInput = {
  records: WorkTimeRecord[];
  days: RestDayInput[];
  intervals: RestIntervalInput[];
};

export type WorkTimeDashboardRow = {
  id: string;
  name: string;
  monthMinutes: number;
  sevenDayMinutes: number;
  cycleDays: number;
  daysUntilWeeklyRest: number | null;
  restKind: "daily" | "weekly" | "split" | null;
  requiredRestMinutes: number;
  restUntil: number | null;
  onDuty: boolean;
  hasUntimedWork: boolean;
  issues: RestIssue[];
  severity: "danger" | "warning" | "normal";
};

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Summarize actual journal entries using the same rest boundaries as the journal. */
export function workTimeDashboardRows(
  people: { id: string; name: string; active: boolean }[],
  input: WorkTimeDashboardInput,
  now = new Date(),
): WorkTimeDashboardRow[] {
  const today = isoDate(now);
  const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const weekFrom = isoDate(sevenDaysAgo);
  const knownDays = input.days.filter((day) => day.start <= now.getTime());
  const knownIntervals = input.intervals.filter((interval) => interval.start <= now.getTime());
  const issues = calculateRestIssues(knownDays, knownIntervals)
    .filter((issue) => issue.actualMinutes >= 0 && issue.date.slice(0, 7) === today.slice(0, 7));

  return people.filter((person) => person.active).map((person): WorkTimeDashboardRow => {
    const records = input.records.filter((record) => record.personId === person.id
      && record.date.slice(0, 10) <= today && activityUsesTime(record.activity)
      && (record.startTime === null || record.startTime <= now.getTime()));
    const minutes = (record: WorkTimeRecord) => Number.isFinite(record.workMinutes) ? Math.max(0, record.workMinutes) : 0;
    const days = knownDays.filter((day) => day.personId === person.id)
      .sort((a, b) => a.start - b.start);
    let cycleDays = 0;
    let previous: RestDayInput | null = null;
    for (const day of days) {
      if (day.assumedCompliant) { previous = null; cycleDays = 0; continue; }
      cycleDays = !previous || (day.start - previous.end) / 60_000 >= WEEKLY_REST_MINUTES ? 1 : cycleDays + 1;
      previous = day;
    }

    let splitRun = 0;
    let previousInterval: RestIntervalInput | null = null;
    for (const interval of knownIntervals.filter((item) => item.personId === person.id)
      .sort((a, b) => a.start - b.start || a.end - b.end)) {
      if (interval.assumedCompliant) { splitRun = 0; previousInterval = null; continue; }
      if (previousInterval && (interval.start - previousInterval.end) / 60_000 >= SPLIT_REST_MINUTES) splitRun = 0;
      splitRun = interval.split ? splitRun + 1 : 0;
      previousInterval = interval;
    }

    const weeklyDue = previous !== null && cycleDays >= 6;
    const dailyMinutes = previous?.dailyRestMinutesAfter ?? DAILY_REST_MINUTES;
    const weeklyUntil = previous ? previous.end + WEEKLY_REST_MINUTES * 60_000 : 0;
    // Weekly and split rest have independent boundaries. One must not shorten the other.
    const candidates: { kind: "daily" | "weekly" | "split"; minutes: number; until: number }[] = [];
    if (previous) candidates.push({ kind: "daily", minutes: dailyMinutes, until: previous.end + dailyMinutes * 60_000 });
    if (weeklyDue) candidates.push({ kind: "weekly", minutes: WEEKLY_REST_MINUTES, until: weeklyUntil });
    if (splitRun >= 2 && previousInterval) candidates.push({ kind: "split", minutes: SPLIT_REST_MINUTES, until: previousInterval.end + SPLIT_REST_MINUTES * 60_000 });
    const required = candidates.filter((item) => item.until > now.getTime()).sort((a, b) => b.until - a.until)[0];
    const weeklyRestComplete = previous !== null && weeklyUntil <= now.getTime();
    if (weeklyRestComplete) cycleDays = 0;
    const ownIssues = issues.filter((issue) => issue.personId === person.id).sort((a, b) => b.date.localeCompare(a.date));
    const daysUntilWeeklyRest = previous ? Math.max(0, 6 - cycleDays) : null;
    const hasUntimedWork = records.some((record) => record.date.startsWith(today.slice(0, 7)) && minutes(record) > 0 && record.startTime === null);
    const severity = ownIssues.length || (weeklyDue && !weeklyRestComplete) ? "danger"
      : required || hasUntimedWork || (daysUntilWeeklyRest !== null && daysUntilWeeklyRest <= 3) ? "warning" : "normal";
    return {
      id: person.id, name: person.name,
      monthMinutes: records.filter((record) => record.date.startsWith(today.slice(0, 7))).reduce((sum, record) => sum + minutes(record), 0),
      sevenDayMinutes: records.filter((record) => record.date.slice(0, 10) >= weekFrom).reduce((sum, record) => sum + minutes(record), 0),
      cycleDays, daysUntilWeeklyRest, restKind: required?.kind ?? null,
      requiredRestMinutes: required?.minutes ?? 0, restUntil: required?.until ?? null,
      onDuty: previous !== null && previous.end > now.getTime(),
      hasUntimedWork, issues: ownIssues, severity,
    };
  }).sort((a, b) => {
    const order = { danger: 0, warning: 1, normal: 2 };
    return order[a.severity] - order[b.severity]
      || (a.daysUntilWeeklyRest ?? 7) - (b.daysUntilWeeklyRest ?? 7)
      || b.monthMinutes - a.monthMinutes || a.name.localeCompare(b.name, "ru-RU");
  });
}
