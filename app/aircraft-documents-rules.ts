export type AircraftDocumentOperation = "КВП" | "АОН";
export type AircraftDocumentScope = "permanent" | "flight";
export type AircraftDocumentMedium = "paper" | "electronic" | "both";

export type AircraftDocumentDefinition = {
  id: string;
  title: string;
  scope: AircraftDocumentScope;
  operations: AircraftDocumentOperation[];
  note?: string;
};

export type AircraftDocumentRecord = {
  id: string;
  definitionId: string;
  title: string;
  aircraft: string;
  aircraftType: string;
  operation: AircraftDocumentOperation;
  scope: AircraftDocumentScope;
  number: string;
  issueDate: string;
  expiryDate: string;
  storagePlace: string;
  medium: AircraftDocumentMedium;
  note: string;
  createdAt: string;
  archivedAt: string;
};

const both: AircraftDocumentOperation[] = ["КВП", "АОН"];

export const AIRCRAFT_DOCUMENT_DEFINITIONS: AircraftDocumentDefinition[] = [
  { id: "registration", title: "Свидетельство о государственной регистрации ВС", scope: "permanent", operations: both },
  { id: "airworthiness", title: "Сертификат лётной годности ВС", scope: "permanent", operations: both },
  { id: "flight-manual", title: "Руководство по лётной эксплуатации", scope: "permanent", operations: both },
  { id: "onboard-log", title: "Бортовой журнал", scope: "permanent", operations: both, note: "Для одночленного экипажа АОН допускается ведение записей в лётной книжке пилота." },
  { id: "sanitary-log", title: "Санитарный журнал", scope: "permanent", operations: both, note: "Может вестись как раздел бортового журнала." },
  { id: "radio-permit", title: "Разрешение на бортовые радиостанции", scope: "permanent", operations: both },
  { id: "aero-information", title: "Актуальная аэронавигационная информация", scope: "permanent", operations: both },
  { id: "flight-charts", title: "Полётные карты", scope: "permanent", operations: both },
  { id: "emergency-instruction", title: "Инструкция по действиям в аварийной обстановке", scope: "permanent", operations: both },
  { id: "incident-form", title: "Форма сообщения об авиационном событии", scope: "permanent", operations: both },
  { id: "operator-certificate", title: "Копия сертификата эксплуатанта", scope: "permanent", operations: ["КВП"] },
  { id: "operations-specifications", title: "Копия эксплуатационных спецификаций КВП", scope: "permanent", operations: ["КВП"] },
  { id: "operations-manual", title: "Руководство по производству полётов (необходимые части)", scope: "permanent", operations: ["КВП"] },
  { id: "commercial-licence", title: "Копия лицензии на коммерческие перевозки пассажиров", scope: "permanent", operations: ["КВП"] },
  { id: "mel", title: "Перечень минимального оборудования (MEL)", scope: "permanent", operations: ["КВП"] },
  { id: "maintenance-release", title: "Документ о технической готовности ВС", scope: "permanent", operations: ["КВП"] },
  { id: "crew-insurance", title: "Страхование членов экипажа", scope: "permanent", operations: ["КВП"] },
  { id: "liability-insurance", title: "Страхование ответственности владельца ВС", scope: "permanent", operations: ["КВП"] },
  { id: "aon-certificate", title: "Копия свидетельства эксплуатанта АОН", scope: "permanent", operations: ["АОН"], note: "Если применимо к эксплуатации данного ВС." },
  { id: "owner-authority", title: "Доверенность собственника на управление ВС", scope: "permanent", operations: ["АОН"], note: "Если собственник отсутствует и полёт выполняется не по заданию эксплуатанта." },
  { id: "flight-assignment", title: "Задание на полёт", scope: "flight", operations: ["КВП"] },
  { id: "operational-flight-plan", title: "Рабочий план полёта", scope: "flight", operations: ["КВП"] },
  { id: "load-sheet", title: "Сводная загрузочная ведомость", scope: "flight", operations: ["КВП"] },
  { id: "passenger-manifest", title: "Список пассажиров", scope: "flight", operations: ["КВП"] },
  { id: "weather-documents", title: "Метеорологическая документация", scope: "flight", operations: both },
  { id: "route-information", title: "Аэронавигационная информация по маршруту", scope: "flight", operations: both },
  { id: "cargo-documents", title: "Документы на груз", scope: "flight", operations: ["КВП"], note: "При перевозке груза." },
  { id: "dangerous-goods", title: "Информация об опасных грузах", scope: "flight", operations: ["КВП"], note: "При наличии опасного груза." },
  { id: "persons-onboard", title: "Список лиц на борту", scope: "flight", operations: ["АОН"] },
  { id: "flight-details", title: "Дата, время, маршрут и регистрационный знак ВС", scope: "flight", operations: ["АОН"] },
  { id: "aon-flight-assignment", title: "Задание на полёт эксплуатанта", scope: "flight", operations: ["АОН"], note: "Если ВС эксплуатируется организацией." },
];

export function aircraftDocumentDefinitions(operation: AircraftDocumentOperation, scope: AircraftDocumentScope) {
  return AIRCRAFT_DOCUMENT_DEFINITIONS.filter((item) => item.scope === scope && item.operations.includes(operation));
}

export function activeAircraftDocument(records: AircraftDocumentRecord[], aircraft: string, operation: AircraftDocumentOperation, definitionId: string) {
  return records
    .filter((item) => !item.archivedAt && item.aircraft === aircraft && item.operation === operation && item.definitionId === definitionId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export function aircraftDocumentState(record: AircraftDocumentRecord | undefined, today = new Date()): "missing" | "expired" | "warning" | "valid" {
  if (!record) return "missing";
  if (!record.expiryDate) return "valid";
  const end = new Date(`${record.expiryDate}T23:59:59`);
  const days = Math.ceil((end.getTime() - today.getTime()) / 86400000);
  if (days < 0) return "expired";
  if (days <= 45) return "warning";
  return "valid";
}

export function normalizeAircraftDocument(record: Partial<AircraftDocumentRecord>): AircraftDocumentRecord {
  return {
    id: record.id ?? "",
    definitionId: record.definitionId ?? "",
    title: record.title ?? "",
    aircraft: record.aircraft ?? "",
    aircraftType: record.aircraftType ?? "",
    operation: record.operation === "АОН" ? "АОН" : "КВП",
    scope: record.scope === "flight" ? "flight" : "permanent",
    number: record.number ?? "",
    issueDate: record.issueDate ?? "",
    expiryDate: record.expiryDate ?? "",
    storagePlace: record.storagePlace ?? "",
    medium: ["paper", "electronic", "both"].includes(record.medium ?? "") ? record.medium as AircraftDocumentMedium : "paper",
    note: record.note ?? "",
    createdAt: record.createdAt ?? new Date().toISOString(),
    archivedAt: record.archivedAt ?? "",
  };
}
