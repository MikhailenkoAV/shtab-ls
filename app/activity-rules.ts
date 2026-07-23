const UNTIMED_ACTIVITIES = new Set(["trip", "vacation", "dayoff", "periodic_training"]);

export function activityUsesTime(activity: string): boolean {
  return !UNTIMED_ACTIVITIES.has(activity);
}

export function isRestNeutralActivity(activity: string): boolean {
  return activity === "periodic_training";
}

export function normalizeActivityTiming(activity: string, start: string, workMinutes: number): { start: string; workMinutes: number } {
  return isRestNeutralActivity(activity)
    ? { start: "", workMinutes: 0 }
    : { start, workMinutes };
}
