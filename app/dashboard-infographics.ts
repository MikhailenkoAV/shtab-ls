export type DashboardPersonRef = { id: string; name: string; active: boolean };
export type DashboardShiftRef = {
  personId: string;
  activity: string;
  workMinutes: number;
  segments: { aircraft: string; flightMinutes: number }[];
};
export type DashboardReadinessRef = { status: "allowed" | "restricted" | "not_allowed" | "undetermined" };

export function readinessSummary(
  people: DashboardPersonRef[],
  readiness: Record<string, DashboardReadinessRef | undefined>,
) {
  const result = { allowed: 0, restricted: 0, notAllowed: 0, undetermined: 0, total: 0 };
  people.filter((person) => person.active).forEach((person) => {
    result.total += 1;
    const status = readiness[person.id]?.status ?? "undetermined";
    if (status === "allowed") result.allowed += 1;
    else if (status === "restricted") result.restricted += 1;
    else if (status === "not_allowed") result.notAllowed += 1;
    else result.undetermined += 1;
  });
  return result;
}

export function workloadSummary(people: DashboardPersonRef[], shifts: DashboardShiftRef[], limit = 7) {
  return people.filter((person) => person.active).map((person) => {
    const own = shifts.filter((shift) => shift.personId === person.id);
    return {
      id: person.id,
      name: person.name,
      workMinutes: own.reduce((sum, shift) => sum + (shift.workMinutes || 0), 0),
      flightMinutes: own.flatMap((shift) => shift.segments ?? []).reduce((sum, segment) => sum + (segment.flightMinutes || 0), 0),
    };
  }).filter((row) => row.workMinutes > 0 || row.flightMinutes > 0)
    .sort((left, right) => right.workMinutes - left.workMinutes || right.flightMinutes - left.flightMinutes || left.name.localeCompare(right.name, "ru-RU"))
    .slice(0, limit);
}

export function aircraftUsageSummary(shifts: DashboardShiftRef[], limit = 7) {
  const usage = new Map<string, { aircraft: string; flightMinutes: number; shifts: Set<DashboardShiftRef> }>();
  shifts.filter((shift) => shift.activity === "flight").forEach((shift) => {
    (shift.segments ?? []).forEach((segment) => {
      const aircraft = segment.aircraft?.trim();
      if (!aircraft) return;
      const current = usage.get(aircraft) ?? { aircraft, flightMinutes: 0, shifts: new Set<DashboardShiftRef>() };
      current.flightMinutes += segment.flightMinutes || 0;
      current.shifts.add(shift);
      usage.set(aircraft, current);
    });
  });
  return [...usage.values()].map((row) => ({ aircraft: row.aircraft, flightMinutes: row.flightMinutes, shiftCount: row.shifts.size }))
    .sort((left, right) => right.flightMinutes - left.flightMinutes || right.shiftCount - left.shiftCount || left.aircraft.localeCompare(right.aircraft, "ru-RU"))
    .slice(0, limit);
}
