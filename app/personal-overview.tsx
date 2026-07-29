"use client";

import { ReactNode, useMemo, useState } from "react";
import type {
  CertificationRecord,
  FlightTimeShiftRef,
  PersonRef,
} from "./personal-files";
import { getExpiryState } from "./personal-files-rules";
import { FlightBookView } from "./flight-book";
import {
  buildFlightBook,
  FlightBookBaseline,
} from "./flight-book-rules";
import {
  aviationWorkLabel,
  calculateDocumentEndDate,
  DEFAULT_PERSONAL_DOCUMENT_DEFINITIONS,
  documentValidityLabel,
  FAP_494_AVIATION_WORKS,
  normalizePilotPersonalProfile,
  periodicMedicalDates,
  PersonalDocumentDefinition,
  PersonalDocumentGroup,
  personalDocumentGroupLabels,
  PilotPersonalProfile,
} from "./pilot-profile-rules";
import { downloadPersonalFlightPdf } from "./personal-file-pdf";

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const localIsoDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const displayDate = (value: string) => value
  ? new Intl.DateTimeFormat("ru-RU").format(new Date(`${value}T12:00:00`))
  : "—";
const displayMinutes = (minutes: number) =>
  `${Math.floor(Math.max(0, minutes) / 60)}:${String(Math.max(0, minutes) % 60).padStart(2, "0")}`;

function recordText(record: CertificationRecord): string {
  return `${record.category} ${record.certificationType} ${record.documentType}`.toLocaleLowerCase("ru-RU");
}

function recordGroup(
  record: CertificationRecord,
  definitions: PersonalDocumentDefinition[],
): PersonalDocumentGroup {
  const haystack = recordText(record);
  const definition = definitions.find((item) =>
    haystack.includes(item.name.toLocaleLowerCase("ru-RU"))
    || haystack.includes(item.category.toLocaleLowerCase("ru-RU")));
  if (definition) return definition.group;
  if (/свидетельств|лиценз|валидац/.test(haystack)) return "licence";
  if (/влэк|медиц|осмотр|заключен/.test(haystack)) return "medical";
  if (/тренаж|квалиф.*провер|аварийн|л[её]тн.*подготов/.test(haystack)) return "flight_training";
  if (/кпк|асп|crm|англий|опасн.*груз|период/.test(haystack)) return "periodic_training";
  return "other";
}

type EditProfileSection = "pilot" | "meteo" | "medical" | "personal" | "aviation";

export function PersonalFilesView({
  people,
  shifts,
  records,
  baselines,
  profiles,
  documentDefinitions,
  onImportClick,
  onUpsert,
  onDelete,
  onUpsertBaseline,
  onDeleteBaseline,
  onProfileChange,
  onDefinitionsChange,
  onNotify,
}: {
  people: PersonRef[];
  shifts: FlightTimeShiftRef[];
  records: CertificationRecord[];
  baselines: FlightBookBaseline[];
  profiles: Record<string, PilotPersonalProfile>;
  documentDefinitions: PersonalDocumentDefinition[];
  onImportClick: () => void;
  onUpsert: (record: CertificationRecord) => void;
  onDelete: (recordId: string) => void;
  onUpsertBaseline: (baseline: FlightBookBaseline) => void;
  onDeleteBaseline: (baselineId: string) => void;
  onProfileChange: (personId: string, profile: PilotPersonalProfile) => void;
  onDefinitionsChange: (definitions: PersonalDocumentDefinition[]) => void;
  onNotify: (message: string) => void;
}) {
  const definitions = documentDefinitions.length
    ? documentDefinitions
    : DEFAULT_PERSONAL_DOCUMENT_DEFINITIONS;
  const sortedPeople = useMemo(
    () => [...people].filter((person) => person.active).sort((left, right) => left.name.localeCompare(right.name, "ru-RU")),
    [people],
  );
  const [selected, setSelected] = useState(sortedPeople[0]?.id ?? "");
  const [mode, setMode] = useState<"overview" | "flightbook">("overview");
  const [operatorFilter, setOperatorFilter] = useState("");
  const [aircraftFilter, setAircraftFilter] = useState("");
  const [seatFilter, setSeatFilter] = useState("");
  const [profileEditing, setProfileEditing] = useState<EditProfileSection | null>(null);
  const [recordEditing, setRecordEditing] = useState<{ record: CertificationRecord | null; group: PersonalDocumentGroup } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const operatorOptions = useMemo(
    () => [...new Set(people.flatMap((person) => person.qualifications.flatMap((item) => item.operators)))].sort(),
    [people],
  );
  const aircraftOptions = useMemo(
    () => [...new Set(people.flatMap((person) => person.aircraftTypes))].sort(),
    [people],
  );
  const seatOptions = useMemo(
    () => [...new Set(people.flatMap((person) => person.qualifications.flatMap((item) => item.seats)))].sort(),
    [people],
  );
  const filteredPeople = useMemo(() => sortedPeople.filter((person) =>
    (!operatorFilter || person.qualifications.some((item) => item.operators.includes(operatorFilter)))
    && (!aircraftFilter || person.aircraftTypes.includes(aircraftFilter))
    && (!seatFilter || person.qualifications.some((item) => item.seats.includes(seatFilter)))),
  [aircraftFilter, operatorFilter, seatFilter, sortedPeople]);
  const personId = filteredPeople.some((person) => person.id === selected)
    ? selected
    : filteredPeople[0]?.id ?? "";
  const person = people.find((item) => item.id === personId);
  const profile = normalizePilotPersonalProfile(profiles[personId]);
  const personRecords = useMemo(
    () => records.filter((record) => record.personId === personId)
      .sort((left, right) => (left.endDate || "9999").localeCompare(right.endDate || "9999")),
    [personId, records],
  );
  const flightBook = useMemo(
    () => buildFlightBook(personId, shifts, baselines, person?.aircraftTypes ?? []),
    [baselines, person?.aircraftTypes, personId, shifts],
  );
  const thisMonth = localIsoDate().slice(0, 7);
  const currentMonthFlight = shifts
    .filter((shift) => shift.personId === personId && shift.activity === "flight" && shift.date.startsWith(thisMonth))
    .reduce((total, shift) => total + shift.segments.reduce((sum, segment) => sum + Math.max(0, segment.flightMinutes || 0), 0), 0);
  const recordsByGroup = (group: PersonalDocumentGroup) =>
    personRecords.filter((record) => recordGroup(record, definitions) === group);

  if (!people.length) return <section className="empty-start">
    <div className="empty-visual"><span>ЛД</span><i /></div>
    <p className="eyebrow">Личные дела</p>
    <h2>Добавьте сотрудников или загрузите выгрузку Авиабит</h2>
    <p>Карточка сотрудника, документы и налёт сохраняются только в локальной базе этого сайта.</p>
    <button className="primary-button" onClick={onImportClick}>Загрузить Excel</button>
  </section>;

  return <div className="records-layout">
    <aside className="pilot-list panel">
      <div className="panel-heading personal-aside-heading">
        <div><p className="eyebrow">Лётный состав</p><h2>Личные дела</h2></div>
        <div>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Настройки личных дел" aria-label="Настройки личных дел">⚙</button>
          <button className="icon-button" onClick={onImportClick} title="Импорт из Авиабит" aria-label="Импорт из Авиабит">＋</button>
        </div>
      </div>
      <div className="pilot-filters">
        <select value={operatorFilter} onChange={(event) => setOperatorFilter(event.target.value)}><option value="">Все эксплуатанты</option>{operatorOptions.map((item) => <option key={item}>{item}</option>)}</select>
        <select value={aircraftFilter} onChange={(event) => setAircraftFilter(event.target.value)}><option value="">Все типы ВС</option>{aircraftOptions.map((item) => <option key={item}>{item}</option>)}</select>
        <select value={seatFilter} onChange={(event) => setSeatFilter(event.target.value)}><option value="">Все кресла</option>{seatOptions.map((item) => <option key={item}>{item}</option>)}</select>
      </div>
      <div className="pilot-items">{filteredPeople.map((item) => {
        const total = buildFlightBook(item.id, shifts, baselines, item.aircraftTypes).total.totalMinutes;
        const warnings = records.filter((record) => record.personId === item.id)
          .filter((record) => ["expired", "alert14", "alert45", "incomplete"].includes(getExpiryState(record).level)).length;
        return <button key={item.id} className={item.id === personId ? "active" : ""} onClick={() => { setSelected(item.id); setMode("overview"); }}>
          <span className="person-avatar small">{item.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span>
          <span><strong>{item.name}</strong><small>{displayMinutes(total)} · {item.aircraftTypes.join(", ")}</small></span>
          {warnings > 0 && <i>{warnings}</i>}
        </button>;
      })}{!filteredPeople.length && <div className="pilot-filter-empty">Сотрудники по фильтрам не найдены.</div>}</div>
    </aside>

    {!person ? <section className="records-main"><div className="panel panel-empty tall">Выберите сотрудника.</div></section> : <section className="records-main">
      <div className="record-hero panel">
        <div className="record-person"><p className="eyebrow">Личное дело</p><h2>{person.name}</h2><span>{[person.position, person.aircraftTypes.join(", ")].filter(Boolean).join(" · ")}</span></div>
        <div className="record-hero-side">
          <div className="record-flight-cards">
            <div className="monthly-flight-card"><span>Налёт в текущем месяце</span><strong>{displayMinutes(currentMonthFlight)}</strong></div>
            <div className="monthly-flight-card total"><span>Общий налёт</span><strong>{displayMinutes(flightBook.total.totalMinutes)}</strong></div>
          </div>
          <div className="hero-actions">
            <button className="secondary-button" onClick={() => void downloadPersonalFlightPdf(person.name, flightBook.rows, flightBook.total.totalMinutes).then(() => onNotify("PDF личного дела сформирован")).catch(() => onNotify("Не удалось сформировать PDF"))}>PDF</button>
            <button className="primary-button" onClick={onImportClick}>Импорт Авиабит</button>
          </div>
        </div>
      </div>
      <div className="personal-view-tabs">
        <button className={mode === "overview" ? "active" : ""} onClick={() => setMode("overview")}>Обзор</button>
        <button className={mode === "flightbook" ? "active" : ""} onClick={() => setMode("flightbook")}>Лётная книжка</button>
      </div>

      {mode === "overview" ? <section className="pilot-frame-grid">
        <PilotDataFrame person={person} profile={profile} onEdit={() => setProfileEditing("pilot")} />
        <PersonalInfoFrame profile={profile} onEdit={() => setProfileEditing("personal")} />
        <LicenceFrame
          records={recordsByGroup("licence")}
          onAdd={() => setRecordEditing({ record: null, group: "licence" })}
          onEdit={(record) => setRecordEditing({ record, group: "licence" })}
        />
        <FlightSummaryFrame flightBook={flightBook} />
        <MedicalFrame
          profile={profile}
          importedRecords={recordsByGroup("medical")}
          onEdit={() => setProfileEditing("medical")}
          onTogglePassed={(date) => {
            const existing = profile.medical.periodicChecks.find((item) => item.date === date);
            const periodicChecks = existing
              ? profile.medical.periodicChecks.map((item) => item.date === date ? { ...item, passed: !item.passed } : item)
              : [...profile.medical.periodicChecks, { id: uid(), date, passed: true }];
            onProfileChange(person.id, { ...profile, medical: { ...profile.medical, periodicChecks } });
          }}
        />
        <MeteoFrame person={person} profile={profile} onEdit={() => setProfileEditing("meteo")} />
        <TrainingFrame
          flightRecords={recordsByGroup("flight_training")}
          periodicRecords={recordsByGroup("periodic_training")}
          onAdd={(group) => setRecordEditing({ record: null, group })}
          onEdit={(record, group) => setRecordEditing({ record, group })}
        />
        {person.qualifications.some((item) => item.operators.length > 0) && <AviationWorksFrame person={person} profile={profile} onEdit={() => setProfileEditing("aviation")} />}
      </section> : <FlightBookView
        person={person}
        shifts={shifts}
        baselines={baselines}
        onUpsert={onUpsertBaseline}
        onDelete={onDeleteBaseline}
      />}
    </section>}

    {profileEditing && person && <ProfileModal
      key={`${person.id}-${profileEditing}`}
      section={profileEditing}
      person={person}
      profile={profile}
      onClose={() => setProfileEditing(null)}
      onSave={(next) => { onProfileChange(person.id, next); setProfileEditing(null); }}
    />}
    {recordEditing && person && <CertificationModal
      personId={person.id}
      personAircraftTypes={person.aircraftTypes}
      personQualifications={person.qualifications}
      record={recordEditing.record}
      group={recordEditing.group}
      definitions={definitions}
      onClose={() => setRecordEditing(null)}
      onSave={(record) => { onUpsert(record); setRecordEditing(null); }}
      onDelete={recordEditing.record ? () => {
        if (window.confirm("Удалить документ из личного дела?")) {
          onDelete(recordEditing.record!.id);
          setRecordEditing(null);
        }
      } : undefined}
    />}
    {settingsOpen && <PersonalDocumentSettingsModal
      definitions={definitions}
      onClose={() => setSettingsOpen(false)}
      onSave={(next) => { onDefinitionsChange(next); setSettingsOpen(false); }}
    />}
  </div>;
}

function Frame({
  title,
  className = "",
  onEdit,
  children,
}: {
  title: string;
  className?: string;
  onEdit?: () => void;
  children: ReactNode;
}) {
  return <article className={`panel pilot-frame ${className}`}>
    <header><h3>{title}</h3>{onEdit && <button onClick={onEdit}>Изменить</button>}</header>
    <div className="pilot-frame-body">{children}</div>
  </article>;
}

function DataRow({ label, value }: { label: string; value: ReactNode }) {
  return <div className="pilot-data-row"><span>{label}</span><strong>{value || "Не внесено"}</strong></div>;
}

function PilotDataFrame({ person, profile, onEdit }: { person: PersonRef; profile: PilotPersonalProfile; onEdit: () => void }) {
  return <Frame title="Данные пилота" onEdit={onEdit}>
    <DataRow label="Должность" value={person.position} />
    <DataRow label="Подразделение" value={profile.division} />
    <DataRow label="Телефон" value={profile.phone} />
    <DataRow label="E-mail" value={profile.email} />
    <DataRow label="Дата рождения" value={displayDate(profile.birthDate)} />
  </Frame>;
}

function FlightSummaryFrame({ flightBook }: { flightBook: ReturnType<typeof buildFlightBook> }) {
  return <Frame title="Налёт">
    <DataRow label="По состоянию на" value={displayDate(localIsoDate())} />
    <DataRow label="Общий" value={displayMinutes(flightBook.total.totalMinutes)} />
    <div className="pilot-flight-types">
      <span>На типе ВС</span>
      <table><tbody>{flightBook.rows.map((row) => <tr key={row.aircraftType}><td>{row.aircraftType}</td><td>{displayMinutes(row.totalMinutes)}</td></tr>)}</tbody></table>
    </div>
    <DataRow label="КВС / ПИ / 2-й пилот" value={`${displayMinutes(flightBook.total.picMinutes)} / ${displayMinutes(flightBook.total.instructorMinutes)} / ${displayMinutes(flightBook.total.secondPilotMinutes)}`} />
    <DataRow label="Ночь" value={displayMinutes(flightBook.total.nightMinutes)} />
    <DataRow label="ППП / Заходы ППП" value={`${displayMinutes(flightBook.total.ifrMinutes)} / ${flightBook.total.ifrApproaches}`} />
  </Frame>;
}

function MeteoFrame({ person, profile, onEdit }: { person: PersonRef; profile: PilotPersonalProfile; onEdit: () => void }) {
  return <Frame title="Метеоминимум" onEdit={onEdit}>
    <div className="table-scroll"><table className="pilot-compact-table"><thead><tr><th>Тип ВС</th><th>День</th><th>Ночь</th><th>Горы</th></tr></thead><tbody>{person.aircraftTypes.map((aircraftType) => {
      const minimum = profile.meteoMinimums[aircraftType];
      return <tr key={aircraftType}><td><strong>{aircraftType}</strong></td><td>{minimum?.day || "—"}</td><td>{minimum?.night || "—"}</td><td>{minimum?.mountains || "—"}</td></tr>;
    })}</tbody></table></div>
  </Frame>;
}

function DocumentState({ record }: { record: CertificationRecord }) {
  const state = getExpiryState(record);
  return <span className={`document-inline-state ${state.level}`}>{state.label}</span>;
}

function DocumentList({ records, empty, onEdit }: { records: CertificationRecord[]; empty: string; onEdit: (record: CertificationRecord) => void }) {
  if (!records.length) return <div className="pilot-frame-empty">{empty}</div>;
  return <div className="pilot-document-list">{records.map((record) => <button key={record.id} onClick={() => onEdit(record)}>
    <span><strong>{record.certificationType || "Документ"}</strong><small>{[record.aircraftType, record.series, record.number].filter(Boolean).join(" · ") || "Сведения не указаны"}</small><small>Выдано: {displayDate(record.issuedDate)} · Действует до: {displayDate(record.endDate)}</small></span>
    <DocumentState record={record} />
  </button>)}</div>;
}

function TrainingFrame({
  flightRecords,
  periodicRecords,
  onAdd,
  onEdit,
}: {
  flightRecords: CertificationRecord[];
  periodicRecords: CertificationRecord[];
  onAdd: (group: PersonalDocumentGroup) => void;
  onEdit: (record: CertificationRecord, group: PersonalDocumentGroup) => void;
}) {
  return <Frame title="Подготовка" className="training-frame">
    <div className="training-columns">
      <section><header><strong>Лётная подготовка</strong><button onClick={() => onAdd("flight_training")}>+ Добавить</button></header><DocumentList records={flightRecords} empty="Документы лётной подготовки не внесены." onEdit={(record) => onEdit(record, "flight_training")} /></section>
      <section><header><strong>Периодическая подготовка</strong><button onClick={() => onAdd("periodic_training")}>+ Добавить</button></header><DocumentList records={periodicRecords} empty="Документы периодической подготовки не внесены." onEdit={(record) => onEdit(record, "periodic_training")} /></section>
    </div>
  </Frame>;
}

function LicenceFrame({ records, onAdd, onEdit }: { records: CertificationRecord[]; onAdd: () => void; onEdit: (record: CertificationRecord) => void }) {
  return <Frame title="Свидетельство и типы ВС">
    <div className="pilot-frame-add"><button onClick={onAdd}>+ Добавить свидетельство или валидацию</button></div>
    <DocumentList records={records} empty="Свидетельства не внесены." onEdit={onEdit} />
  </Frame>;
}

function MedicalFrame({
  profile,
  importedRecords,
  onEdit,
  onTogglePassed,
}: {
  profile: PilotPersonalProfile;
  importedRecords: CertificationRecord[];
  onEdit: () => void;
  onTogglePassed: (date: string) => void;
}) {
  const fallback = importedRecords[0];
  const medical = profile.medical;
  const periodicDates = periodicMedicalDates(medical);
  return <Frame title="Медицинское заключение" onEdit={onEdit}>
    <DataRow label="Класс" value={medical.medicalClass || fallback?.certificationType} />
    <DataRow label="Серия / номер" value={medical.seriesNumber || [fallback?.series, fallback?.number].filter(Boolean).join(" / ")} />
    <DataRow label="Дата прохождения" value={displayDate(medical.examinationDate || fallback?.startDate || fallback?.issuedDate || "")} />
    <DataRow label="Дата окончания" value={displayDate(medical.expiryDate || fallback?.endDate || "")} />
    <DataRow label="Периодический осмотр" value={`каждые ${medical.periodicIntervalMonths} месяцев`} />
    {medical.expiryDate && (() => {
      const state = getExpiryState({
        endDate: medical.expiryDate,
        startDate: medical.examinationDate,
        issuedDate: medical.examinationDate,
        organization: "",
        documentType: "Медицинское заключение",
        number: medical.seriesNumber,
      });
      return <span className={`medical-expiry-state ${state.level}`}>{state.label}</span>;
    })()}
    <div className="periodic-checks">{periodicDates.map((date) => {
      const passed = medical.periodicChecks.some((item) => item.date === date && item.passed);
      return <div key={date}><span>{displayDate(date)}</span><button className={passed ? "passed" : ""} onClick={() => onTogglePassed(date)}>{passed ? "Пройден" : "Отметить «Пройден»"}</button></div>;
    })}</div>
  </Frame>;
}

function PersonalInfoFrame({ profile, onEdit }: { profile: PilotPersonalProfile; onEdit: () => void }) {
  const info = profile.personalInfo;
  return <Frame title="Личная информация" onEdit={onEdit}>
    <DataRow label="Образование" value={info.educationLevel} />
    <DataRow label="Специальность" value={info.specialty} />
    <DataRow label="Документ об образовании" value={info.educationSeriesNumber} />
    <DataRow label="Паспорт" value={info.passportSeriesNumber} />
    <DataRow label="Загранпаспорт" value={info.internationalPassportSeriesNumber} />
    <DataRow label="ИНН" value={info.inn} />
    <DataRow label="СНИЛС" value={info.snils} />
  </Frame>;
}

function AviationWorksFrame({ person, profile, onEdit }: { person: PersonRef; profile: PilotPersonalProfile; onEdit: () => void }) {
  return <Frame title="Авиационные работы" className="aviation-works-frame" onEdit={onEdit}>
    <div className="aviation-work-summary">{person.aircraftTypes.map((aircraftType) => {
      const selected = profile.aviationWorks[aircraftType] ?? [];
      return <section key={aircraftType}><strong>{aircraftType}</strong><span>{selected.length ? `${selected.length} видов работ` : "Допуски не указаны"}</span>{selected.slice(0, 3).map((id) => <small key={id}>{aviationWorkLabel(id)}</small>)}</section>;
    })}</div>
  </Frame>;
}

function ProfileModal({
  section,
  person,
  profile,
  onClose,
  onSave,
}: {
  section: EditProfileSection;
  person: PersonRef;
  profile: PilotPersonalProfile;
  onClose: () => void;
  onSave: (profile: PilotPersonalProfile) => void;
}) {
  const [draft, setDraft] = useState(() => normalizePilotPersonalProfile(profile));
  const [aviationType, setAviationType] = useState(person.aircraftTypes[0] ?? "");
  const title = {
    pilot: "Данные пилота",
    meteo: "Метеоминимум",
    medical: "Медицинское заключение",
    personal: "Личная информация",
    aviation: "Авиационные работы",
  }[section];
  const updateRoot = (key: "division" | "phone" | "email" | "birthDate", value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`modal ${section === "aviation" ? "extra-wide" : "wide"}`} role="dialog" aria-modal="true">
      <header><div><p className="eyebrow">Личное дело · {person.name}</p><h2>{title}</h2></div><button className="modal-close" aria-label="Закрыть" onClick={onClose}>×</button></header>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
        {section === "pilot" && <>
          <div className="form-grid two"><label className="field"><span>Должность</span><input disabled value={person.position} /></label><label className="field"><span>Подразделение — необязательно</span><input value={draft.division} onChange={(event) => updateRoot("division", event.target.value)} /></label></div>
          <div className="form-grid two"><label className="field"><span>Телефон</span><input value={draft.phone} onChange={(event) => updateRoot("phone", event.target.value)} /></label><label className="field"><span>E-mail</span><input type="email" value={draft.email} onChange={(event) => updateRoot("email", event.target.value)} /></label></div>
          <label className="field"><span>Дата рождения</span><input type="date" value={draft.birthDate} onChange={(event) => updateRoot("birthDate", event.target.value)} /></label>
        </>}
        {section === "meteo" && <div className="meteo-edit-list">{person.aircraftTypes.map((aircraftType) => {
          const minimum = draft.meteoMinimums[aircraftType] ?? { day: "", night: "", mountains: "" };
          const update = (key: "day" | "night" | "mountains", value: string) => setDraft((current) => ({
            ...current,
            meteoMinimums: { ...current.meteoMinimums, [aircraftType]: { ...minimum, [key]: value } },
          }));
          return <article key={aircraftType}><strong>{aircraftType}</strong><div className="form-grid three"><label className="field"><span>День</span><input value={minimum.day} onChange={(event) => update("day", event.target.value)} placeholder="ПВП 200 × 3000" /></label><label className="field"><span>Ночь</span><input value={minimum.night} onChange={(event) => update("night", event.target.value)} /></label><label className="field"><span>Горы</span><input value={minimum.mountains} onChange={(event) => update("mountains", event.target.value)} /></label></div></article>;
        })}</div>}
        {section === "medical" && <>
          <div className="form-grid two"><label className="field"><span>Класс</span><input value={draft.medical.medicalClass} onChange={(event) => setDraft((current) => ({ ...current, medical: { ...current.medical, medicalClass: event.target.value } }))} /></label><label className="field"><span>Серия / номер</span><input value={draft.medical.seriesNumber} onChange={(event) => setDraft((current) => ({ ...current, medical: { ...current.medical, seriesNumber: event.target.value } }))} /></label></div>
          <div className="form-grid three"><label className="field"><span>Дата прохождения</span><input type="date" value={draft.medical.examinationDate} onChange={(event) => setDraft((current) => ({ ...current, medical: { ...current.medical, examinationDate: event.target.value } }))} /></label><label className="field"><span>Дата окончания</span><input type="date" value={draft.medical.expiryDate} onChange={(event) => setDraft((current) => ({ ...current, medical: { ...current.medical, expiryDate: event.target.value } }))} /></label><label className="field"><span>Периодический осмотр</span><select value={draft.medical.periodicIntervalMonths} onChange={(event) => setDraft((current) => ({ ...current, medical: { ...current.medical, periodicIntervalMonths: Number(event.target.value) as 3 | 6 | 12 } }))}><option value={3}>Каждые 3 месяца</option><option value={6}>Каждые 6 месяцев</option><option value={12}>Каждые 12 месяцев</option></select></label></div>
        </>}
        {section === "personal" && <>
          <div className="form-grid two"><label className="field"><span>Образование</span><select value={draft.personalInfo.educationLevel} onChange={(event) => setDraft((current) => ({ ...current, personalInfo: { ...current.personalInfo, educationLevel: event.target.value } }))}><option value="">Не указано</option><option>Среднее профессиональное образование</option><option>Высшее образование</option></select></label><label className="field"><span>Специальность</span><input value={draft.personalInfo.specialty} onChange={(event) => setDraft((current) => ({ ...current, personalInfo: { ...current.personalInfo, specialty: event.target.value } }))} /></label></div>
          <label className="field"><span>Серия и номер документа об образовании</span><input value={draft.personalInfo.educationSeriesNumber} onChange={(event) => setDraft((current) => ({ ...current, personalInfo: { ...current.personalInfo, educationSeriesNumber: event.target.value } }))} /></label>
          <div className="form-grid two"><label className="field"><span>Паспорт — серия и номер</span><input value={draft.personalInfo.passportSeriesNumber} onChange={(event) => setDraft((current) => ({ ...current, personalInfo: { ...current.personalInfo, passportSeriesNumber: event.target.value } }))} /></label><label className="field"><span>Загранпаспорт — серия и номер</span><input value={draft.personalInfo.internationalPassportSeriesNumber} onChange={(event) => setDraft((current) => ({ ...current, personalInfo: { ...current.personalInfo, internationalPassportSeriesNumber: event.target.value } }))} /></label></div>
          <div className="form-grid two"><label className="field"><span>ИНН</span><input value={draft.personalInfo.inn} onChange={(event) => setDraft((current) => ({ ...current, personalInfo: { ...current.personalInfo, inn: event.target.value } }))} /></label><label className="field"><span>СНИЛС</span><input value={draft.personalInfo.snils} onChange={(event) => setDraft((current) => ({ ...current, personalInfo: { ...current.personalInfo, snils: event.target.value } }))} /></label></div>
        </>}
        {section === "aviation" && <>
          <label className="field"><span>Тип ВС</span><select value={aviationType} onChange={(event) => setAviationType(event.target.value)}>{person.aircraftTypes.map((aircraftType) => <option key={aircraftType}>{aircraftType}</option>)}</select></label>
          <div className="aviation-work-picker">{FAP_494_AVIATION_WORKS.map((group) => <fieldset key={group.id}><legend>{group.title}</legend>{group.items.map((item) => {
            const values = draft.aviationWorks[aviationType] ?? [];
            return <label key={item.id}><input type="checkbox" checked={values.includes(item.id)} onChange={() => setDraft((current) => {
              const currentValues = current.aviationWorks[aviationType] ?? [];
              const nextValues = currentValues.includes(item.id) ? currentValues.filter((id) => id !== item.id) : [...currentValues, item.id];
              return { ...current, aviationWorks: { ...current.aviationWorks, [aviationType]: nextValues } };
            })} /><span>{item.label}</span></label>;
          })}</fieldset>)}</div>
        </>}
        <div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button className="primary-button" type="submit">Сохранить</button></div>
      </form>
    </section>
  </div>;
}

function CertificationModal({
  personId,
  personAircraftTypes,
  personQualifications,
  record,
  group,
  definitions,
  onClose,
  onSave,
  onDelete,
}: {
  personId: string;
  personAircraftTypes: string[];
  personQualifications: PersonRef["qualifications"];
  record: CertificationRecord | null;
  group: PersonalDocumentGroup;
  definitions: PersonalDocumentDefinition[];
  onClose: () => void;
  onSave: (record: CertificationRecord) => void;
  onDelete?: () => void;
}) {
  const groupDefinitions = definitions.filter((item) => item.group === group);
  const initialDefinition = groupDefinitions[0];
  const [form, setForm] = useState<CertificationRecord>(record ?? {
    id: uid(),
    personId,
    category: initialDefinition?.category ?? personalDocumentGroupLabels[group],
    certificationType: initialDefinition?.name ?? "",
    aircraftType: "",
    organization: "",
    issuedDate: "",
    startDate: "",
    endDate: "",
    documentType: "",
    grade: "",
    series: "",
    number: "",
    documentAvailable: "",
    note: "",
    source: "manual",
    sourceFile: "",
    importedAt: new Date().toISOString(),
  });
  const update = (key: keyof CertificationRecord, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const selectedDefinitionId = groupDefinitions.find((item) => item.name === form.certificationType)?.id
    ?? (form.certificationType ? "__legacy" : "");
  const selectedDefinition = groupDefinitions.find((item) => item.id === selectedDefinitionId);
  const relevantOperators = [...new Set(personQualifications
    .filter((item) => !form.aircraftType || item.aircraftTypes.includes(form.aircraftType))
    .flatMap((item) => item.operators)
    .filter((item) => item === "КВП" || item === "АОН"))];
  const needsOperator = Boolean(selectedDefinition?.validityByOperatorMonths);
  const updateWithCalculatedEnd = (patch: Partial<CertificationRecord>) => setForm((current) => {
    const next = { ...current, ...patch };
    const definition = definitions.find((item) => item.name === next.certificationType);
    const calculated = calculateDocumentEndDate(next.issuedDate, definition, next.operator ?? "");
    return { ...next, endDate: calculated || next.endDate };
  });
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal wide" role="dialog" aria-modal="true">
      <header><div><p className="eyebrow">Личное дело</p><h2>{record ? "Изменить документ" : `Добавить: ${personalDocumentGroupLabels[group]}`}</h2></div><button className="modal-close" aria-label="Закрыть" onClick={onClose}>×</button></header>
      <form className="form-stack" onSubmit={(event) => {
        event.preventDefault();
        if (form.certificationType.trim()) onSave({ ...form, source: "manual", importedAt: new Date().toISOString() });
      }}>
        {groupDefinitions.length > 0 && <label className="field"><span>Документ</span><select required value={selectedDefinitionId} onChange={(event) => {
          const definition = definitions.find((item) => item.id === event.target.value);
          if (definition) updateWithCalculatedEnd({ certificationType: definition.name, category: definition.category, operator: "" });
        }}><option value="">Выбрать документ…</option>{selectedDefinitionId === "__legacy" && <option value="__legacy">{form.certificationType}</option>}{groupDefinitions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <div className="form-grid two"><label className="field"><span>Тип ВС</span><input list="personal-aircraft-types" value={form.aircraftType} onChange={(event) => updateWithCalculatedEnd({ aircraftType: event.target.value, operator: "" })} /></label><label className="field"><span>Организация</span><input value={form.organization} onChange={(event) => update("organization", event.target.value)} /></label></div>
        <datalist id="personal-aircraft-types">{personAircraftTypes.map((aircraftType) => <option key={aircraftType}>{aircraftType}</option>)}</datalist>
        {needsOperator && <label className="field"><span>Эксплуатант для расчёта срока</span><select required value={form.operator ?? ""} onChange={(event) => updateWithCalculatedEnd({ operator: event.target.value })}><option value="">Выберите эксплуатанта…</option>{relevantOperators.map((operator) => <option key={operator}>{operator}</option>)}</select></label>}
        <div className="form-grid two"><label className="field"><span>Дата выдачи</span><input type="date" value={form.issuedDate} onChange={(event) => updateWithCalculatedEnd({ issuedDate: event.target.value })} /></label><label className="field"><span>Дата окончания действия</span><input type="date" value={form.endDate} onChange={(event) => update("endDate", event.target.value)} />{documentValidityLabel(selectedDefinition, form.operator) && <small>Автоматический срок: {documentValidityLabel(selectedDefinition, form.operator)}</small>}</label></div>
        <div className="form-grid two"><label className="field"><span>Серия</span><input value={form.series} onChange={(event) => update("series", event.target.value)} /></label><label className="field"><span>Номер</span><input value={form.number} onChange={(event) => update("number", event.target.value)} /></label></div>
        <label className="field"><span>Дополнительные сведения</span><textarea value={form.note} onChange={(event) => update("note", event.target.value)} /></label>
        <div className="form-actions split">{onDelete && <button type="button" className="danger-button" onClick={onDelete}>Удалить</button>}<span /><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button className="primary-button">Сохранить</button></div>
      </form>
    </section>
  </div>;
}

function PersonalDocumentSettingsModal({
  definitions,
  onClose,
  onSave,
}: {
  definitions: PersonalDocumentDefinition[];
  onClose: () => void;
  onSave: (definitions: PersonalDocumentDefinition[]) => void;
}) {
  const [rows, setRows] = useState(definitions);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal extra-wide" role="dialog" aria-modal="true">
      <header><div><p className="eyebrow">Личные дела</p><h2>Настройки документов</h2><span>Названия и категории используются при добавлении документов в личное дело</span></div><button className="modal-close" aria-label="Закрыть" onClick={onClose}>×</button></header>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSave(rows.filter((item) => item.name.trim() && item.category.trim())); }}>
        <div className="document-definition-list">{rows.map((row) => <article key={row.id}>
          <label className="field"><span>Раздел</span><select value={row.group} onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, group: event.target.value as PersonalDocumentGroup } : item))}>{(Object.keys(personalDocumentGroupLabels) as PersonalDocumentGroup[]).map((group) => <option key={group} value={group}>{personalDocumentGroupLabels[group]}</option>)}</select></label>
          <label className="field"><span>Название документа</span><input value={row.name} onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, name: event.target.value } : item))} /></label>
          <label className="field"><span>Категория</span><input value={row.category} onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, category: event.target.value } : item))} /></label>
          <button type="button" className="danger-button compact" onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}>Удалить</button>
        </article>)}</div>
        <button type="button" className="secondary-button" onClick={() => setRows((current) => [...current, { id: uid(), name: "", category: "", group: "other" }])}>+ Добавить документ</button>
        <div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button className="primary-button">Сохранить настройки</button></div>
      </form>
    </section>
  </div>;
}
