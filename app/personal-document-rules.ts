import { canonicalAircraftType } from "./aircraft-rules.ts";

type QualificationRef = { operators: string[]; aircraftTypes: string[] };

export function operatorsForDocument(
  qualifications: QualificationRef[],
  aircraftType: string,
  currentOperator = "",
): string[] {
  const allowed = (value: string) => value === "КВП" || value === "АОН";
  const target = canonicalAircraftType(aircraftType);
  const typeOperators = qualifications
    .filter((qualification) => !target || qualification.aircraftTypes.some((type) => canonicalAircraftType(type) === target))
    .flatMap((qualification) => qualification.operators)
    .filter(allowed);
  const allOperators = qualifications.flatMap((qualification) => qualification.operators).filter(allowed);
  return [...new Set([...(typeOperators.length ? typeOperators : allOperators), currentOperator].filter(allowed))];
}
