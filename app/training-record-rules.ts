import { canonicalAircraftType } from "./aircraft-rules.ts";

type TrainingRecord = {
  aircraftType: string;
  certificationType: string;
};

export function isSimulatorOrCabinTraining(value: string): boolean {
  const normalized = value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
  return /тренажерн.*подготов|тренаж.*кабин/.test(normalized);
}

export function trainingNameForAircraft(aircraftType: string, currentName: string): string {
  if (!isSimulatorOrCabinTraining(currentName)) return currentName;
  const type = canonicalAircraftType(aircraftType);
  if (!type) return currentName;
  return type === "R44" ? "Тренажерная подготовка" : "Тренаж в кабине ВС";
}

export function canonicalTrainingDocumentName(value: string): string {
  const normalized = value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е")
    .replace(/[^a-zа-я0-9]+/g, " ").trim();
  if (/^квалификац(ионная)? проверка инструктор$/.test(normalized)) {
    return "Квалификационная проверка Пилот-инструктор";
  }
  if (normalized === "квалификационная проверка" || normalized === "квалификац проверка") {
    return "Квалификационная проверка КВС";
  }
  return value;
}

export function normalizeTrainingRecord<T extends TrainingRecord>(record: T): T {
  const aircraftType = canonicalAircraftType(record.aircraftType);
  const certificationType = canonicalTrainingDocumentName(record.certificationType);
  return {
    ...record,
    aircraftType,
    certificationType: trainingNameForAircraft(aircraftType, certificationType),
  };
}
