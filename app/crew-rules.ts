export type CrewSegmentRef = {
  id?: string;
  seat?: string;
  commanderPersonId?: string;
  crewPairing?: "instructor_commander" | "pic_pilot";
  dutyStart?: string;
  dutyEnd?: string;
  excludedWorkMinutes?: number;
};

export type CrewShiftRef<S extends CrewSegmentRef = CrewSegmentRef> = {
  id: string;
  personId: string;
  activity: string;
  start?: string;
  workMinutes?: number;
  segments: S[];
  linkedSourceShiftId?: string;
  linkedPrimaryPersonId?: string;
};

function clockMinutes(value?: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  if (!match || +match[1] > 23 || +match[2] > 59) return null;
  return +match[1] * 60 + +match[2];
}

export function crewDutyMinutes(segments: CrewSegmentRef[]): number {
  const ranges = segments.flatMap((segment) => {
    const start = clockMinutes(segment.dutyStart);
    let end = clockMinutes(segment.dutyEnd);
    if (start === null || end === null || start === end) return [];
    if (end < start) end += 1_440;
    return [{ start, end }];
  }).sort((left, right) => left.start - right.start);

  if (!ranges.length) return 0;
  let total = 0;
  let currentStart = ranges[0].start;
  let currentEnd = ranges[0].end;
  ranges.slice(1).forEach((range) => {
    if (range.start <= currentEnd) currentEnd = Math.max(currentEnd, range.end);
    else {
      total += currentEnd - currentStart;
      currentStart = range.start;
      currentEnd = range.end;
    }
  });
  const dutyMinutes = total + currentEnd - currentStart;
  const excludedMinutes = segments.reduce(
    (sum, segment) => sum + Math.max(0, segment.excludedWorkMinutes ?? 0),
    0,
  );
  return Math.max(0, dutyMinutes - excludedMinutes);
}

export function linkedCrewShiftId(sourceShiftId: string, personId: string): string {
  return `${sourceShiftId}::crew::${personId}`;
}

export function expandLinkedCrewShifts<
  S extends CrewSegmentRef,
  T extends CrewShiftRef<S>,
>(shifts: T[]): T[] {
  const expanded: T[] = [];
  shifts.forEach((shift) => {
    expanded.push(shift);
    if (shift.activity !== "flight") return;

    const segmentsByCommander = new Map<string, S[]>();
    shift.segments.forEach((segment) => {
      const commanderPersonId = segment.seat?.toLocaleLowerCase("ru-RU").includes("инструктор") || segment.crewPairing === "pic_pilot"
        ? segment.commanderPersonId?.trim()
        : "";
      if (!commanderPersonId || commanderPersonId === shift.personId) return;
      segmentsByCommander.set(commanderPersonId, [
        ...(segmentsByCommander.get(commanderPersonId) ?? []),
        segment,
      ]);
    });

    segmentsByCommander.forEach((segments, commanderPersonId) => {
      const commanderSegments = segments.map((segment) => ({
        ...segment,
        seat: "КВС",
        commanderPersonId: undefined,
      })) as S[];
      const firstStart = [...commanderSegments]
        .map((segment) => segment.dutyStart ?? "")
        .filter(Boolean)
        .sort()[0] ?? shift.start ?? "";
      expanded.push({
        ...shift,
        id: linkedCrewShiftId(shift.id, commanderPersonId),
        personId: commanderPersonId,
        start: firstStart,
        workMinutes: crewDutyMinutes(commanderSegments),
        segments: commanderSegments,
        linkedSourceShiftId: shift.id,
        linkedPrimaryPersonId: shift.personId,
      });
    });
  });
  return expanded;
}
