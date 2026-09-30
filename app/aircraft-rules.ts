export type AircraftOperator = "КВП" | "АОН" | "АР";

export type AircraftConfig = {
  id: string;
  type: string;
  number: string;
  operator: AircraftOperator;
  monthlyPlanEnabled: boolean;
};

export const aircraftNumbersByType: Readonly<Record<string, readonly string[]>> = {
  AW109: ["RA-01902"],
  AW139: ["RA-01697"],
  A109: ["RA-07701"],
  BO105: ["RA-02549", "RA-2991G"],
  R66: ["RA-07375", "RA-05828"],
  R44: ["RA-04186", "RA-04359"],
  AS350: ["RA-07338", "RA-04063"],
  Bell407: ["RA-01619"],
};

export const DEFAULT_AIRCRAFT_FLEET: AircraftConfig[] = Object.entries(aircraftNumbersByType)
  .flatMap(([type, numbers]) => numbers.map((number) => ({
    id: `aircraft-${number.toLowerCase()}`,
    type,
    number,
    operator: "АОН" as AircraftOperator,
    monthlyPlanEnabled: !["RA-01619", "RA-05828", "RA-01697", "RA-04063"].includes(number),
  })));

export function aircraftNumbersMap(fleet: AircraftConfig[]): Readonly<Record<string, readonly string[]>> {
  const result: Record<string, string[]> = {};
  fleet.forEach((aircraft) => {
    const type = canonicalAircraftType(aircraft.type);
    result[type] = [...(result[type] ?? []), aircraft.number.trim().toUpperCase()];
  });
  return result;
}

export function canonicalAircraftType(value: string): string {
  const compact = value.trim().toUpperCase().replace(/[^A-ZА-Я0-9]/g, "");
  if (compact === "BELL407") return "Bell407";
  if (compact === "BO105" || compact === "ВО105") return "BO105";
  if (compact === "R66" || compact === "ROBINSON66" || compact === "ROBINSONR66") return "R66";
  if (compact === "R44" || compact === "ROBINSON44" || compact === "ROBINSONR44") return "R44";
  if (compact === "AS350" || compact === "AS350B3") return "AS350";
  return value.trim();
}

export function aircraftNumbersForType(aircraftType: string): readonly string[] {
  return aircraftNumbersByType[canonicalAircraftType(aircraftType)] ?? [];
}

export function isAircraftNumberAllowed(aircraftType: string, aircraftNumber: string): boolean {
  const availableNumbers = aircraftNumbersForType(aircraftType);
  return !availableNumbers.length || availableNumbers.includes(aircraftNumber);
}
