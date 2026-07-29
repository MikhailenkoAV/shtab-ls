export type MeteoMinimum = {
  day: string;
  night: string;
  mountains: string;
};

export type MedicalPeriodicCheck = {
  id: string;
  date: string;
  passed: boolean;
};

export type PilotMedicalProfile = {
  medicalClass: string;
  seriesNumber: string;
  examinationDate: string;
  expiryDate: string;
  periodicIntervalMonths: 3 | 6 | 12;
  periodicChecks: MedicalPeriodicCheck[];
};

export type PilotPersonalInfo = {
  educationLevel: string;
  specialty: string;
  educationSeriesNumber: string;
  passportSeriesNumber: string;
  internationalPassportSeriesNumber: string;
  inn: string;
  snils: string;
};

export type PilotPersonalProfile = {
  division: string;
  phone: string;
  email: string;
  birthDate: string;
  meteoMinimums: Record<string, MeteoMinimum>;
  medical: PilotMedicalProfile;
  personalInfo: PilotPersonalInfo;
  aviationWorks: Record<string, string[]>;
};

export type PersonalDocumentGroup =
  | "flight_training"
  | "periodic_training"
  | "licence"
  | "medical"
  | "other";

export type PersonalDocumentDefinition = {
  id: string;
  name: string;
  category: string;
  group: PersonalDocumentGroup;
  validityMonths?: number;
  validityDays?: number;
  validityByOperatorMonths?: Partial<Record<"КВП" | "АОН", number>>;
};

export const personalDocumentGroupLabels: Record<PersonalDocumentGroup, string> = {
  flight_training: "Лётная подготовка",
  periodic_training: "Периодическая подготовка",
  licence: "Свидетельство и типы ВС",
  medical: "Медицинское заключение",
  other: "Прочие документы",
};

export const PERSONAL_DOCUMENT_DEFINITIONS_VERSION = 3;

export const DEFAULT_PERSONAL_DOCUMENT_DEFINITIONS: PersonalDocumentDefinition[] = [
  { id: "flight-proficiency-pic", name: "Квалификационная проверка КВС", category: "Лётная подготовка", group: "flight_training", validityMonths: 12 },
  { id: "flight-proficiency-instructor", name: "Квалификационная проверка Пилот-инструктор", category: "Лётная подготовка", group: "flight_training", validityMonths: 12 },
  { id: "flight-cabin", name: "Тренаж в кабине ВС", category: "Лётная подготовка", group: "flight_training", validityDays: 90 },
  { id: "flight-simulator", name: "Тренажерная подготовка", category: "Лётная подготовка", group: "flight_training", validityMonths: 7 },
  { id: "periodic-aviation-security", name: "Авиационная безопасность", category: "Периодическая подготовка", group: "periodic_training", validityMonths: 36 },
  { id: "periodic-english", name: "Английский язык", category: "Периодическая подготовка", group: "periodic_training", validityMonths: 36 },
  { id: "periodic-asp-water", name: "АСП вода", category: "Периодическая подготовка", group: "periodic_training", validityMonths: 24 },
  { id: "periodic-asp-land-type", name: "АСП суша (на типе)", category: "Периодическая подготовка", group: "periodic_training", validityMonths: 12 },
  { id: "periodic-type", name: "КПК на типе ВС", category: "Периодическая подготовка", group: "periodic_training", validityByOperatorMonths: { КВП: 12, АОН: 60 } },
  { id: "periodic-dangerous", name: "Опасные грузы", category: "Периодическая подготовка", group: "periodic_training", validityMonths: 24 },
  { id: "periodic-human-factor", name: "Человеческий фактор", category: "Периодическая подготовка", group: "periodic_training", validityMonths: 36 },
  { id: "licence-private", name: "Свидетельство частного пилота", category: "Свидетельство", group: "licence" },
  { id: "licence-commercial", name: "Свидетельство коммерческого пилота", category: "Свидетельство", group: "licence" },
  { id: "licence-airline", name: "Свидетельство линейного пилота", category: "Свидетельство", group: "licence" },
  { id: "licence-validation", name: "Валидация", category: "Свидетельство", group: "licence" },
  { id: "medical-conclusion", name: "Медицинское заключение", category: "Медицина", group: "medical" },
];

const LEGACY_BUILT_IN_DOCUMENT_IDS = new Set([
  "flight-cabin",
  "flight-proficiency",
  "flight-emergency",
  "periodic-type",
  "periodic-crm",
  "periodic-asp",
  "periodic-dangerous",
  "periodic-english",
  "licence-pilot",
  "licence-validation",
  "medical-conclusion",
  "periodic-medical",
]);

export function migratePersonalDocumentDefinitions(
  definitions: PersonalDocumentDefinition[] | undefined,
  version = 0,
): PersonalDocumentDefinition[] {
  if (version >= PERSONAL_DOCUMENT_DEFINITIONS_VERSION) {
    return definitions?.length ? definitions : DEFAULT_PERSONAL_DOCUMENT_DEFINITIONS;
  }
  const customDefinitions = (definitions ?? []).filter((definition) =>
    !LEGACY_BUILT_IN_DOCUMENT_IDS.has(definition.id)
    && !DEFAULT_PERSONAL_DOCUMENT_DEFINITIONS.some((builtIn) => builtIn.id === definition.id));
  return [...DEFAULT_PERSONAL_DOCUMENT_DEFINITIONS, ...customDefinitions];
}

export function documentValidityLabel(
  definition: PersonalDocumentDefinition | undefined,
  operator = "",
): string {
  if (!definition) return "";
  const operatorMonths = definition.validityByOperatorMonths?.[operator as "КВП" | "АОН"];
  if (operatorMonths) return `${operatorMonths} мес. (${operator})`;
  if (definition.validityDays) return `${definition.validityDays} дн.`;
  if (definition.validityMonths) return `${definition.validityMonths} мес.`;
  return "";
}

function isoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function calculateDocumentEndDate(
  issuedDate: string,
  definition: PersonalDocumentDefinition | undefined,
  operator = "",
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(issuedDate);
  if (!match || !definition) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (definition.validityDays) {
    date.setUTCDate(date.getUTCDate() + definition.validityDays);
    return isoDate(date);
  }
  const months = definition.validityByOperatorMonths?.[operator as "КВП" | "АОН"]
    ?? definition.validityMonths;
  if (!months) return "";
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay));
  return isoDate(date);
}

export const EMPTY_PILOT_PERSONAL_PROFILE: PilotPersonalProfile = {
  division: "",
  phone: "",
  email: "",
  birthDate: "",
  meteoMinimums: {},
  medical: {
    medicalClass: "",
    seriesNumber: "",
    examinationDate: "",
    expiryDate: "",
    periodicIntervalMonths: 6,
    periodicChecks: [],
  },
  personalInfo: {
    educationLevel: "",
    specialty: "",
    educationSeriesNumber: "",
    passportSeriesNumber: "",
    internationalPassportSeriesNumber: "",
    inn: "",
    snils: "",
  },
  aviationWorks: {},
};

export function normalizePilotPersonalProfile(
  value?: Partial<PilotPersonalProfile>,
): PilotPersonalProfile {
  return {
    ...EMPTY_PILOT_PERSONAL_PROFILE,
    ...(value ?? {}),
    meteoMinimums: value?.meteoMinimums ?? {},
    medical: {
      ...EMPTY_PILOT_PERSONAL_PROFILE.medical,
      ...(value?.medical ?? {}),
      periodicChecks: value?.medical?.periodicChecks ?? [],
    },
    personalInfo: {
      ...EMPTY_PILOT_PERSONAL_PROFILE.personalInfo,
      ...(value?.personalInfo ?? {}),
    },
    aviationWorks: value?.aviationWorks ?? {},
  };
}

function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function periodicMedicalDates(profile: PilotMedicalProfile): string[] {
  if (!profile.examinationDate || !profile.expiryDate) return [];
  const start = new Date(`${profile.examinationDate}T12:00:00`);
  const end = new Date(`${profile.expiryDate}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) return [];
  const dates: string[] = [];
  const current = new Date(start);
  while (true) {
    current.setMonth(current.getMonth() + profile.periodicIntervalMonths);
    if (current >= end) break;
    dates.push(localIsoDate(current));
  }
  return dates;
}

export type AviationWorkItem = {
  id: string;
  label: string;
};

export type AviationWorkGroup = {
  id: string;
  title: string;
  items: AviationWorkItem[];
};

export const FAP_494_AVIATION_WORKS: AviationWorkGroup[] = [
  {
    id: "chemical",
    title: "1. Авиационно-химические работы",
    items: [
      { id: "1a", label: "Авиационное распределение жидких веществ" },
      { id: "1b", label: "Внесение жидких агрохимикатов" },
      { id: "1c", label: "Защита растений от вредителей, болезней и сорняков" },
      { id: "1d", label: "Внесение регуляторов роста растений" },
      { id: "1e", label: "Дефолиация, десикация, сеникация и химическая чеканка растений" },
      { id: "1f", label: "Борьба с кровососущими насекомыми, клещами, разносчиками заболеваний животных и грызунами" },
      { id: "1g", label: "Рекультивация земель, дедикация почвы, детоксикация закрытых водоёмов" },
      { id: "1h", label: "Закрепление пылящей поверхности" },
      { id: "1i", label: "Борьба с нефтяными пятнами" },
      { id: "1j", label: "Тушение пожаров лесов, пастбищ, жилых и промышленных объектов" },
      { id: "1k", label: "Авиационное распределение сыпучих веществ" },
      { id: "1l", label: "Авиационное распределение биологических объектов" },
    ],
  },
  {
    id: "survey",
    title: "2. Воздушные съёмки",
    items: [
      { id: "2a", label: "Аэросъёмочные работы" },
      { id: "2b", label: "Аэрофотосъёмочные работы" },
      { id: "2c", label: "Телевизионные и киносъёмочные работы" },
    ],
  },
  {
    id: "forest",
    title: "3. Лесоавиационные работы",
    items: [
      { id: "3a", label: "Авиационная охрана лесов" },
      { id: "3b", label: "Обследование и учёт лесов" },
      { id: "3c", label: "Обслуживание организаций лесоохраны и лесопользования" },
    ],
  },
  {
    id: "construction",
    title: "4. Строительно-монтажные и погрузочно-разгрузочные работы",
    items: [
      { id: "4a", label: "Монтаж и демонтаж строительных конструкций, линий электропередач, трубопроводов" },
      { id: "4b", label: "Перевозка грузов на внешней подвеске" },
      { id: "4c", label: "Проведение погрузочно-разгрузочных операций" },
    ],
  },
  {
    id: "medical",
    title: "5. Работы с целью оказания медицинской помощи",
    items: [
      { id: "5a", label: "Доставка больных и медицинского персонала" },
      { id: "5b", label: "Доставка медицинских грузов" },
    ],
  },
  {
    id: "flight-checks",
    title: "6. Лётные проверки наземных средств",
    items: [
      { id: "6a", label: "Лётные проверки наземных средств радиотехнического обеспечения полётов" },
      { id: "6b", label: "Лётные проверки авиационной воздушной электросвязи" },
      { id: "6c", label: "Лётные проверки систем светосигнального оборудования аэродромов" },
    ],
  },
  {
    id: "rescue",
    title: "7. Поисково-спасательные и аварийно-спасательные работы",
    items: [
      { id: "7a", label: "Поисково-спасательные и аварийно-спасательные работы" },
    ],
  },
  {
    id: "transport",
    title: "8. Транспортно-связные работы",
    items: [
      { id: "8a1", label: "Персонал в фюзеляже с посадкой и высадкой основным способом" },
      { id: "8a2", label: "Персонал в фюзеляже с подъёмом и (или) высадкой на специальных подъёмно-спусковых устройствах" },
      { id: "8a3", label: "Персонал в фюзеляже с десантированием на парашютах" },
      { id: "8a4", label: "Персонал на внешней подвеске в транспортно-спасательных кабинах" },
      { id: "8b1", label: "Грузы в фюзеляже с погрузкой и выгрузкой основным способом" },
      { id: "8b2", label: "Грузы в фюзеляже со сбрасыванием на парашютах, платформах или в спасательных контейнерах" },
      { id: "8b3", label: "Грузы в фюзеляже со сбрасыванием без парашютов, платформ и контейнеров" },
      { id: "8b4", label: "Грузы в фюзеляже со спуском на специальных спусковых устройствах" },
      { id: "8b5", label: "Грузы на внешней подвеске со средствами стабилизации и снижения аэродинамического сопротивления" },
      { id: "8b6", label: "Грузы на внешней подвеске со средствами стабилизации" },
      { id: "8b7", label: "Грузы на внешней подвеске со средствами снижения аэродинамического сопротивления" },
      { id: "8b8", label: "Грузы на внешней подвеске без средств стабилизации и снижения аэродинамического сопротивления" },
    ],
  },
  {
    id: "visual",
    title: "9. Аэровизуальные полёты",
    items: [
      { id: "9a", label: "Воздушное наблюдение" },
      { id: "9b", label: "Контроль экологического состояния воздушной среды, участков суши и водной поверхности" },
      { id: "9c", label: "Обследование пастбищ, птиц, животных, обездвиживание и отстрел животных" },
      { id: "9d", label: "Разведка косяков рыбы, морского зверя и наведение рыболовецких судов" },
      { id: "9e", label: "Обследование путей транспортировки и путей миграции птиц и животных" },
      { id: "9f", label: "Контроль дорожного движения и района массовых мероприятий" },
      { id: "9g", label: "Ледовые наблюдения и контроль ледовой обстановки" },
      { id: "9h", label: "Наблюдение и контроль в районах наводнений и стихийных бедствий" },
      { id: "9i1", label: "Воздушное патрулирование трубопроводов" },
      { id: "9i2", label: "Воздушное патрулирование линий электропередачи" },
      { id: "9i3", label: "Воздушное патрулирование прибрежных районов" },
      { id: "9i4", label: "Воздушное патрулирование пограничных районов" },
      { id: "9j1", label: "Проводка судов во льдах" },
      { id: "9j2", label: "Сопровождение движущихся объектов" },
      { id: "9k1", label: "Трансляция радио- и телепередач" },
      { id: "9k2", label: "Разбрасывание листовок и печатных средств массовой информации" },
      { id: "9k3", label: "Передача информации через громкоговорящее устройство" },
    ],
  },
];

export function aviationWorkLabel(id: string): string {
  return FAP_494_AVIATION_WORKS.flatMap((group) => group.items)
    .find((item) => item.id === id)?.label ?? id;
}
