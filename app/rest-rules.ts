export const DAILY_REST_MINUTES = 12 * 60;
export const WEEKLY_REST_MINUTES = 42 * 60;
export const SPLIT_REST_MINUTES = 48 * 60;

export type RestBoundaryInput = {
  date: string;
  start: number;
  end: number;
};

export function restMinutesAroundDate(date: string, workDays: RestBoundaryInput[]): number | undefined {
  const sortedDays = [...workDays].sort((left, right) => left.start - right.start);
  const previous = sortedDays.filter((day) => day.date < date).at(-1);
  const next = sortedDays.find((day) => day.date > date);
  if (!previous || !next) return undefined;
  return (next.start - previous.end) / 60_000;
}

export type RestDayInput = {
  shiftId: string;
  personId: string;
  date: string;
  start: number;
  end: number;
  assumedCompliant?: boolean;
};

export type RestIntervalInput = {
  shiftId: string;
  personId: string;
  date: string;
  start: number;
  end: number;
  split: boolean;
  assumedCompliant?: boolean;
};

export type RestIssue = {
  id: string;
  shiftId: string;
  personId: string;
  date: string;
  kind: "daily" | "weekly" | "split";
  requiredMinutes: number;
  actualMinutes: number;
};

export type WeeklyRestWarning = {
  id: string;
  personId: string;
  date: string;
  workDays: number;
  daysRemaining: number;
};

export function calculateRestIssues(daysInput: RestDayInput[], intervalsInput: RestIntervalInput[]): RestIssue[] {
  const issues = new Map<string, RestIssue>();
  const addIssue = (issue: RestIssue) => {
    const current = issues.get(issue.shiftId);
    if (!current || issue.requiredMinutes > current.requiredMinutes) issues.set(issue.shiftId, issue);
  };

  const daysByPerson = new Map<string, RestDayInput[]>();
  daysInput.forEach((day) => daysByPerson.set(day.personId, [...(daysByPerson.get(day.personId) ?? []), day]));
  daysByPerson.forEach((unsortedDays, personId) => {
    const days = [...unsortedDays].sort((left, right) => left.start - right.start);
    let consecutiveWorkDays = 0;
    let previous: RestDayInput | null = null;
    days.forEach((day) => {
      if (day.assumedCompliant) {
        consecutiveWorkDays = 0;
        previous = null;
        return;
      }
      if (!previous) {
        consecutiveWorkDays = 1;
        previous = day;
        return;
      }
      const rest = (day.start - previous.end) / 60_000;
      const weeklyRestRequired = consecutiveWorkDays >= 6;

      // A negative interval is an overlap, which is intentionally not reported
      // by the rest-control module.
      if (rest >= 0) {
        if (weeklyRestRequired && rest < WEEKLY_REST_MINUTES) {
          addIssue({
            id: `weekly-${personId}-${day.date}`,
            shiftId: day.shiftId,
            personId,
            date: day.date,
            kind: "weekly",
            requiredMinutes: WEEKLY_REST_MINUTES,
            actualMinutes: rest,
          });
        } else if (rest < DAILY_REST_MINUTES) {
          addIssue({
            id: `daily-${personId}-${day.date}`,
            shiftId: day.shiftId,
            personId,
            date: day.date,
            kind: "daily",
            requiredMinutes: DAILY_REST_MINUTES,
            actualMinutes: rest,
          });
        }
      }

      const hasFullWeeklyRest = rest >= WEEKLY_REST_MINUTES;
      consecutiveWorkDays = hasFullWeeklyRest ? 1 : consecutiveWorkDays + 1;
      previous = day;
    });
  });

  const intervalsByPerson = new Map<string, RestIntervalInput[]>();
  intervalsInput.forEach((interval) => intervalsByPerson.set(interval.personId, [...(intervalsByPerson.get(interval.personId) ?? []), interval]));
  intervalsByPerson.forEach((unsortedIntervals, personId) => {
    const intervals = [...unsortedIntervals].sort((left, right) => left.start - right.start || left.end - right.end);
    let splitRun = 0;
    intervals.forEach((interval, index) => {
      if (interval.assumedCompliant) {
        splitRun = 0;
        return;
      }
      const previous = intervals[index - 1];
      if (previous && splitRun >= 2) {
        const rest = (interval.start - previous.end) / 60_000;
        if (rest >= 0 && rest < SPLIT_REST_MINUTES) {
          addIssue({
            id: `split-${personId}-${interval.shiftId}`,
            shiftId: interval.shiftId,
            personId,
            date: interval.date,
            kind: "split",
            requiredMinutes: SPLIT_REST_MINUTES,
            actualMinutes: rest,
          });
        }
        if (rest >= SPLIT_REST_MINUTES) splitRun = 0;
      }
      splitRun = interval.split ? splitRun + 1 : 0;
    });
  });

  return [...issues.values()].sort((left, right) => `${left.date}-${left.personId}`.localeCompare(`${right.date}-${right.personId}`));
}

export function calculateWeeklyRestWarnings(
  daysInput: RestDayInput[],
  today = new Date(),
): WeeklyRestWarning[] {
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const todayEnd = todayStart + 86_400_000 - 1;
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const byPerson = new Map<string, RestDayInput[]>();
  daysInput.filter((day) => day.start <= todayEnd)
    .forEach((day) => byPerson.set(day.personId, [...(byPerson.get(day.personId) ?? []), day]));

  const warnings: WeeklyRestWarning[] = [];
  byPerson.forEach((unsortedDays, personId) => {
    const days = [...unsortedDays].sort((left, right) => left.start - right.start);
    let consecutiveWorkDays = 0;
    let previous: RestDayInput | null = null;
    for (const day of days) {
      if (day.assumedCompliant) {
        consecutiveWorkDays = 0;
        previous = null;
        continue;
      }
      if (!previous) consecutiveWorkDays = 1;
      else {
        const rest = (day.start - previous.end) / 60_000;
        consecutiveWorkDays = rest >= WEEKLY_REST_MINUTES ? 1 : consecutiveWorkDays + 1;
      }
      previous = day;
    }

    if (!previous || consecutiveWorkDays < 3) return;
    const currentRest = (today.getTime() - previous.end) / 60_000;
    if (currentRest >= WEEKLY_REST_MINUTES) return;
    const daysRemaining = Math.max(0, 6 - consecutiveWorkDays);
    if (daysRemaining > 3) return;
    warnings.push({
      id: `weekly-warning-${personId}-${todayIso}`,
      personId,
      date: todayIso,
      workDays: consecutiveWorkDays,
      daysRemaining,
    });
  });
  return warnings.sort((left, right) => left.personId.localeCompare(right.personId));
}

export function isSundayDate(value: string): boolean {
  if (!value) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && date.getDay() === 0;
}
