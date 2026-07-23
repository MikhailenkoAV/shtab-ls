export const aircraftNumbersByType: Readonly<Record<string, readonly string[]>> = {
  AW109: ["RA-01902"],
  A109: ["RA-07701"],
  BO105: ["RA-02549", "RA-2991G"],
  R66: ["RA-07375", "RA-05828"],
  R44: ["RA-04186", "RA-04359"],
  AS350: ["RA-07338", "RA-04063"],
};

export function aircraftNumbersForType(aircraftType: string): readonly string[] {
  return aircraftNumbersByType[aircraftType] ?? [];
}

export function isAircraftNumberAllowed(aircraftType: string, aircraftNumber: string): boolean {
  const availableNumbers = aircraftNumbersForType(aircraftType);
  return !availableNumbers.length || availableNumbers.includes(aircraftNumber);
}
