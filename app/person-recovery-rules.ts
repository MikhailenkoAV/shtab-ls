export function appendMissingRecords<T extends { id: string }>(current: T[], saved: T[]): T[] {
  const ids = new Set(current.map((item) => item.id));
  return [...current, ...saved.filter((item) => !ids.has(item.id))];
}

type LinkedShift = { id: string; personId: string; segments: { id: string; commanderPersonId?: string }[] };
/** Restore only the removed person's records and the removed links in surviving shifts. */
export function restorePersonShifts<T extends LinkedShift>(current: T[], saved: T[], personId: string): T[] {
  const savedById = new Map(saved.map((item) => [item.id, item]));
  const surviving = current.map((shift) => {
    const original = savedById.get(shift.id);
    if (!original || shift.personId === personId) return shift;
    return { ...shift, segments: shift.segments.map((segment) => {
      const link = original.segments.find((item) => item.id === segment.id);
      return !segment.commanderPersonId && link?.commanderPersonId === personId ? { ...segment, commanderPersonId: personId } : segment;
    }) };
  });
  return appendMissingRecords(surviving, saved.filter((shift) => shift.personId === personId));
}
