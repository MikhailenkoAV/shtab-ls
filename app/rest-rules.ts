export const DAILY_REST_MINUTES = 12 * 60;
export const WEEKLY_REST_MINUTES = 42 * 60;
export const SPLIT_REST_MINUTES = 48 * 60;
export const DAY_OFF_REST_MINUTES = 24 * 60;

export function fixedRestMinutesForActivity(activity: string): number | undefined {
  return activity === "dayoff" ? DAY_OFF_REST_MINUTES : undefined;
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

function calendarDayDifference(later: string, earlier: string): number {
  const laterDate = new Date(`${later}T12:00:00`);
  const earlierDate = new Date(`${earlier}T12:00:00`);
  return Math.round((laterDate.getTime() - earlierDate.getTime()) / 86_400_000);
}

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
      const interruptedBeforeSixDays = consecutiveWorkDays < 6 && calendarDayDifference(day.date, previous.date) > 1;
      consecutiveWorkDays = hasFullWeeklyRest || interruptedBeforeSixDays ? 1 : consecutiveWorkDays + 1;
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

export function isSundayDate(value: string): boolean {
  if (!value) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && date.getDay() === 0;
}
