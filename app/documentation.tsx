"use client";

import { useMemo, useState } from "react";
import {
  downloadMedicalReferralWord,
  downloadPersonalFlightCertificateWord,
  downloadQualificationCheckPdf,
  downloadTrainingRequestWord,
  qualificationResultText,
  TrainingRequestRow,
} from "./document-exports";
import {
  DocumentPersonProfile,
  DocumentRegistryKind,
  DocumentRegistryRecord,
  DocumentSettings,
  EMPTY_DOCUMENT_PROFILE,
  MedicalReferralRecord,
  nextMedicalReferralNumber,
  nextRegistryNumber,
  registryKindLabels,
} from "./documentation-rules";
import {
  buildFlightBook,
  FlightBookBaseline,
  FlightBookShiftRef,
} from "./flight-book-rules";
import { AircraftDocumentsView } from "./aircraft-documents";
import { AircraftDocumentRecord } from "./aircraft-documents-rules";

type DocumentationPerson = {
  id: string;
  name: string;
  position: string;
  aircraftTypes: string[];
  active: boolean;
  division: string;
  qualifications: { aircraftTypes: string[]; seats: string[] }[];
};

type DocumentationCertification = {
  personId: string;
  category: string;
  certificationType: string;
  aircraftType: string;
  organization: string;
  issuedDate: string;
  startDate: string;
  endDate: string;
  documentType: string;
  number: string;
  grade: string;
};

type DocumentationCompany = {
  fullName: string;
  shortName: string;
  chiefOfStaff: string;
};

type DocumentationTab = "registry" | "aircraft" | "forms" | "references";
type FormKind = "training" | "qualification" | "flight-certificate" | "medical-referral";
type RegistrySection = DocumentRegistryKind | "medicalReferral";
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const localIsoDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const displayDate = (value: string) => value
  ? new Intl.DateTimeFormat("ru-RU").format(new Date(`${value}T12:00:00`))
  : "—";

export function DocumentationView({
  people,
  certifications,
  shifts,
  baselines,
  registry,
  medicalReferrals,
  profiles,
  settings,
  company,
  aircraftDocuments,
  onUpsertRegistry,
  onDeleteRegistry,
  onUpsertMedicalReferral,
  onDeleteMedicalReferral,
  onSettingsChange,
  onSaveAircraftDocument,
  onDeleteAircraftDocument,
  onNotify,
}: {
  people: DocumentationPerson[];
  certifications: DocumentationCertification[];
  shifts: FlightBookShiftRef[];
  baselines: FlightBookBaseline[];
  registry: DocumentRegistryRecord[];
  medicalReferrals: MedicalReferralRecord[];
  profiles: Record<string, DocumentPersonProfile>;
  settings: DocumentSettings;
  company: DocumentationCompany;
  aircraftDocuments: AircraftDocumentRecord[];
  onUpsertRegistry: (record: DocumentRegistryRecord) => void;
  onDeleteRegistry: (recordId: string) => void;
  onUpsertMedicalReferral: (record: MedicalReferralRecord) => void;
  onDeleteMedicalReferral: (recordId: string) => void;
  onSettingsChange: (patch: Partial<DocumentSettings>) => void;
  onSaveAircraftDocument: (record: AircraftDocumentRecord, replaceId?: string) => void;
  onDeleteAircraftDocument: (recordId: string) => void;
  onNotify: (message: string) => void;
}) {
  const activePeople = useMemo(
    () => people.filter((person) => person.active).sort((left, right) => left.name.localeCompare(right.name, "ru-RU")),
    [people],
  );
  const [tab, setTab] = useState<DocumentationTab>("registry");
  const [formKind, setFormKind] = useState<FormKind>("training");
  const [registryKind, setRegistryKind] = useState<RegistrySection>("order");
  const [registryQuery, setRegistryQuery] = useState("");
  const [registryYear, setRegistryYear] = useState("");
  const [registryEditing, setRegistryEditing] = useState<DocumentRegistryRecord | "new" | null>(null);
  const [medicalEditing, setMedicalEditing] = useState<MedicalReferralRecord | "new" | null>(null);
  const years = useMemo(() => [...new Set([
    ...registry.map((record) => record.date.slice(0, 4)),
    ...medicalReferrals.map((record) => record.issueDate.slice(0, 4)),
  ].filter(Boolean))].sort().reverse(), [registry, medicalReferrals]);
  const visibleRegistry = useMemo(() => registry.filter((record) =>
    registryKind !== "medicalReferral" && record.kind === registryKind
    && (!registryYear || record.date.startsWith(registryYear))
    && `${record.number} ${record.subject}`.toLocaleLowerCase("ru-RU")
      .includes(registryQuery.trim().toLocaleLowerCase("ru-RU")))
    .sort((left, right) => `${right.date}|${right.number}`.localeCompare(`${left.date}|${left.number}`, "ru-RU")),
  [registry, registryKind, registryQuery, registryYear]);

  function resolvedProfile(personId: string): DocumentPersonProfile {
    const saved = { ...EMPTY_DOCUMENT_PROFILE, ...(profiles[personId] ?? {}) };
    const licence = certifications.find((record) =>
      record.personId === personId
      && /свидетельств|лиценз|пилот/i.test(`${record.category} ${record.certificationType} ${record.documentType}`));
    return {
      ...saved,
      pilotLicenceKind: saved.pilotLicenceKind || licence?.documentType || licence?.certificationType || "Свидетельство пилота",
      pilotLicenceNumber: saved.pilotLicenceNumber || licence?.number || "",
    };
  }

  const [trainingSelected, setTrainingSelected] = useState<string[]>([]);
  const [trainingRows, setTrainingRows] = useState<Record<string, TrainingRequestRow>>({});
  const [trainingForm, setTrainingForm] = useState({
    requestDate: localIsoDate(),
    programName: settings.trainingPrograms[0] ?? "",
    hours: "",
    dateFrom: "",
    dateTo: "",
  });

  const [qualificationPersonId, setQualificationPersonId] = useState(activePeople[0]?.id ?? "");
  const [qualificationForm, setQualificationForm] = useState({
    aircraftType: "",
    aircraftNumber: "",
    flightTime: "",
    landings: "",
    checkDate: localIsoDate(),
    checkPlace: "",
    seat: "КВС",
    examinerName: "",
    examinerLicence: "",
    examinerRole: "Пилот-инструктор",
  });
  const [certificatePersonId, setCertificatePersonId] = useState(activePeople[0]?.id ?? "");
  const [certificateIssueDate, setCertificateIssueDate] = useState(localIsoDate());
  const [certificateNumber, setCertificateNumber] = useState(
    nextRegistryNumber(registry, "certificate", localIsoDate()),
  );
  const [medicalPersonId, setMedicalPersonId] = useState(activePeople[0]?.id ?? "");
  const [medicalOrganizationId, setMedicalOrganizationId] = useState(settings.medicalOrganizations[0]?.id ?? "");
  const [medicalForm, setMedicalForm] = useState({
    issueDate: localIsoDate(),
    referralNumber: nextMedicalReferralNumber(medicalReferrals),
    examKind: "периодический",
    basis: "Периодический (годовой)",
    issuer: ["Начальник штаба", company.chiefOfStaff].filter(Boolean).join(" — "),
    position: activePeople[0]?.position ?? "",
    division: activePeople[0]?.division ?? "",
  });
  const selectedProgramHours = settings.trainingProgramHours?.[trainingForm.programName] ?? [];
  const selectedProgramKind = settings.trainingProgramVariants?.[trainingForm.programName]
    ?.find((variant) => variant.hours === trainingForm.hours)?.kind
    ?? settings.trainingProgramKinds?.[trainingForm.programName]
    ?? "";

  function updateTrainingProgram(index: number, nextName: string) {
    const previousName = settings.trainingPrograms[index];
    const trainingPrograms = settings.trainingPrograms.map((item, itemIndex) =>
      itemIndex === index ? nextName : item);
    const trainingProgramHours = { ...(settings.trainingProgramHours ?? {}) };
    const trainingProgramKinds = { ...(settings.trainingProgramKinds ?? {}) };
    if (previousName !== nextName) {
      trainingProgramHours[nextName] = trainingProgramHours[previousName] ?? [];
      trainingProgramKinds[nextName] = trainingProgramKinds[previousName] ?? "";
      delete trainingProgramHours[previousName];
      delete trainingProgramKinds[previousName];
    }
    onSettingsChange({ trainingPrograms, trainingProgramHours, trainingProgramKinds });
  }

  function deleteTrainingProgram(index: number) {
    const name = settings.trainingPrograms[index];
    const trainingProgramHours = { ...(settings.trainingProgramHours ?? {}) };
    const trainingProgramKinds = { ...(settings.trainingProgramKinds ?? {}) };
    delete trainingProgramHours[name];
    delete trainingProgramKinds[name];
    onSettingsChange({
      trainingPrograms: settings.trainingPrograms.filter((_, itemIndex) => itemIndex !== index),
      trainingProgramHours,
      trainingProgramKinds,
    });
  }

  function makeTrainingRow(personId: string): TrainingRequestRow {
    const person = activePeople.find((item) => item.id === personId);
    const itemProfile = resolvedProfile(personId);
    return {
      personName: person?.name ?? "",
      birthDate: itemProfile.birthDate,
      aircraftType: person?.aircraftTypes.join(", ") ?? "",
      position: person?.position ?? "",
      snils: itemProfile.snils,
      educationDocument: [itemProfile.educationDocumentSeries, itemProfile.educationDocumentNumber].filter(Boolean).join(" № "),
      educationQualification: itemProfile.educationQualification,
      educationLevel: itemProfile.educationLevel,
      passport: [itemProfile.passportSeries, itemProfile.passportNumber].filter(Boolean).join(" № "),
    };
  }

  function toggleTrainingPerson(personId: string) {
    setTrainingSelected((current) => current.includes(personId)
      ? current.filter((item) => item !== personId)
      : [...current, personId]);
    setTrainingRows((current) => current[personId] ? current : { ...current, [personId]: makeTrainingRow(personId) });
  }

  async function runExport(action: () => Promise<void>, success: string) {
    try {
      await action();
      onNotify(success);
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : "Не удалось сформировать документ");
    }
  }

  return <section className="documentation-layout">
    <article className="panel documentation-intro"><div><p className="eyebrow">Документы лётной службы</p><h2>Документационный контур</h2><p>Реестр перенесён из вашей рабочей книги. Формы заполняются из личных дел, а незаполненные поля можно исправить прямо перед выгрузкой.</p></div><span>Локальная база</span></article>
    <nav className="documentation-tabs panel" aria-label="Разделы документации">
      <button className={tab === "registry" ? "active" : ""} onClick={() => setTab("registry")}><strong>Реестр</strong><small>{registry.length} записей</small></button>
      <button className={tab === "aircraft" ? "active" : ""} onClick={() => setTab("aircraft")}><strong>Судовая документация</strong><small>КВП и АОН</small></button>
      <button className={tab === "forms" ? "active" : ""} onClick={() => setTab("forms")}><strong>Формирование</strong><small>Word и PDF</small></button>
      <button className={tab === "references" ? "active" : ""} onClick={() => setTab("references")}><strong>Справочники</strong><small>АУЦ и программы</small></button>
    </nav>

    {tab === "aircraft" && <AircraftDocumentsView records={aircraftDocuments} people={people} certifications={certifications} onSave={onSaveAircraftDocument} onDelete={onDeleteAircraftDocument} />}

    {tab === "registry" && <section className="panel documentation-workspace">
      <div className="panel-heading"><div><p className="eyebrow">Реестр ЛС</p><h2>{registryKind === "medicalReferral" ? "Медицинские направления" : registryKindLabels[registryKind]}</h2></div><button className="primary-button" onClick={() => registryKind === "medicalReferral" ? setMedicalEditing("new") : setRegistryEditing("new")}>+ Новая запись</button></div>
      <div className="registry-kind-tabs">{(Object.keys(registryKindLabels) as DocumentRegistryKind[]).map((kind) =>
        <button key={kind} className={registryKind === kind ? "active" : ""} onClick={() => setRegistryKind(kind)}><span>{registryKindLabels[kind]}</span><i>{registry.filter((record) => record.kind === kind).length}</i></button>)}
        <button className={registryKind === "medicalReferral" ? "active" : ""} onClick={() => setRegistryKind("medicalReferral")}><span>Медицинские направления</span><i>{medicalReferrals.length}</i></button>
      </div>
      <div className="records-toolbar registry-toolbar">
        <input value={registryQuery} onChange={(event) => setRegistryQuery(event.target.value)} placeholder="Поиск по номеру или содержанию…" />
        <select value={registryYear} onChange={(event) => setRegistryYear(event.target.value)}><option value="">Все годы</option>{years.map((year) => <option key={year}>{year}</option>)}</select>
      </div>
      {registryKind === "medicalReferral" ? <MedicalReferralTable records={medicalReferrals} query={registryQuery} year={registryYear} onEdit={setMedicalEditing} /> : !visibleRegistry.length ? <div className="panel-empty tall">Записи по выбранному фильтру не найдены.</div> : <div className="table-scroll"><table className="registry-table"><thead><tr><th>Номер</th><th>Дата</th><th>Содержание</th><th /></tr></thead><tbody>{visibleRegistry.map((record) =>
        <tr key={record.id}><td><strong>{record.number || "—"}</strong></td><td>{displayDate(record.date)}</td><td className="note-cell">{record.subject || "—"}</td><td><button className="row-action" onClick={() => setRegistryEditing(record)}>Изменить</button></td></tr>)}</tbody></table></div>}
    </section>}

    {tab === "references" && <section className="panel documentation-workspace">
      <div className="panel-heading"><div><p className="eyebrow">Справочники форм</p><h2>АУЦ, ВЛЭК и программы обучения</h2></div><span className="settings-auto-save">Сохраняется автоматически</span></div>
      <div className="document-profile-form form-stack">
        <div className="form-grid two">
          <ProfileField label="Наименование АУЦ" value={settings.trainingCenterName} onChange={(value) => onSettingsChange({ trainingCenterName: value })} />
          <ProfileField label="Руководитель / адресат" value={settings.trainingCenterHead} onChange={(value) => onSettingsChange({ trainingCenterHead: value })} />
        </div>
        <div className="training-program-settings">
          <div className="training-program-settings-head"><strong>Справочник ВЛЭК</strong><button className="secondary-button compact" type="button" onClick={() => onSettingsChange({ medicalOrganizations: [...settings.medicalOrganizations, { id: uid(), name: "", address: "", ogrn: "" }] })}>+ Добавить ВЛЭК</button></div>
          {settings.medicalOrganizations.map((organization) => <article key={organization.id}>
            <ProfileField label="Наименование" value={organization.name} onChange={(value) => onSettingsChange({ medicalOrganizations: settings.medicalOrganizations.map((item) => item.id === organization.id ? { ...item, name: value } : item) })} />
            <ProfileField label="Адрес" value={organization.address} onChange={(value) => onSettingsChange({ medicalOrganizations: settings.medicalOrganizations.map((item) => item.id === organization.id ? { ...item, address: value } : item) })} />
            <ProfileField label="ОГРН" value={organization.ogrn} onChange={(value) => onSettingsChange({ medicalOrganizations: settings.medicalOrganizations.map((item) => item.id === organization.id ? { ...item, ogrn: value } : item) })} />
            <button type="button" className="danger-button compact" onClick={() => onSettingsChange({ medicalOrganizations: settings.medicalOrganizations.filter((item) => item.id !== organization.id) })}>Удалить</button>
          </article>)}
          {!settings.medicalOrganizations.length && <div className="panel-empty">Добавьте организацию ВЛЭК: наименование, адрес и ОГРН.</div>}
        </div>
        <div className="training-program-settings">
          <div className="training-program-settings-head"><strong>Программы, вид обучения и часы</strong><button className="secondary-button compact" type="button" onClick={() => onSettingsChange({ trainingPrograms: [...settings.trainingPrograms, "Новая программа"] })}>+ Добавить программу</button></div>
          {settings.trainingPrograms.map((program, index) => <article key={`${program}-${index}`}>
            <label className="field"><span>Наименование программы</span><input value={program} onChange={(event) => updateTrainingProgram(index, event.target.value)} /></label>
            <label className="field"><span>Вид обучения</span><input value={settings.trainingProgramKinds?.[program] ?? ""} onChange={(event) => onSettingsChange({ trainingProgramKinds: { ...(settings.trainingProgramKinds ?? {}), [program]: event.target.value } })} /></label>
            <label className="field"><span>Варианты часов — через запятую</span><input value={(settings.trainingProgramHours?.[program] ?? []).join(", ")} onChange={(event) => onSettingsChange({
              trainingProgramHours: {
                ...(settings.trainingProgramHours ?? {}),
                [program]: event.target.value.split(",").map((item) => item.trim()).filter(Boolean),
              },
            })} placeholder="40, 72" /></label>
            <button type="button" className="danger-button compact" onClick={() => deleteTrainingProgram(index)}>Удалить</button>
          </article>)}
          {!settings.trainingPrograms.length && <div className="panel-empty">Добавьте первую программу обучения.</div>}
        </div>
        <div className="form-grid two">
          <ProfileField label="E-mail отправителя" value={settings.senderEmail} onChange={(value) => onSettingsChange({ senderEmail: value })} />
          <ProfileField label="Телефон отправителя" value={settings.senderPhone} onChange={(value) => onSettingsChange({ senderPhone: value })} />
        </div>
        <div className="report-scope-note">Справочник используется как подстановка. В самой заявке любое поле остаётся доступным для ручного исправления до выгрузки.</div>
      </div>
    </section>}

    {tab === "forms" && <section className="documentation-form-layout">
      <aside className="panel document-form-menu">{([
        ["training", "Заявка в АУЦ", "Word · ручная проверка полей"],
        ["flight-certificate", "Персональная справка о налёте", "Word · форма АО ЦА «Солярис»"],
        ["qualification", "Вкладыш квалификационной проверки", "PDF · 105 × 148 мм"],
        ["medical-referral", "Направление на ВЛЭК", "Word · строго по образцу"],
      ] as const).map(([kind, title, detail]) => <button key={kind} className={formKind === kind ? "active" : ""} onClick={() => setFormKind(kind)}><strong>{title}</strong><small>{detail}</small></button>)}
      </aside>

      {formKind === "training" && <article className="panel documentation-workspace">
        <div className="panel-heading"><div><p className="eyebrow">Word-документ</p><h2>Заявка на обучение в АУЦ</h2></div></div>
        <div className="document-profile-form form-stack">
          <div className="form-grid two">
            <ProfileField label="Наименование АУЦ" value={settings.trainingCenterName} onChange={(value) => onSettingsChange({ trainingCenterName: value })} />
            <ProfileField label="Руководитель / адресат" value={settings.trainingCenterHead} onChange={(value) => onSettingsChange({ trainingCenterHead: value })} />
          </div>
          <div className="form-grid three">
            <ProfileField label="Дата заявки" type="date" value={trainingForm.requestDate} onChange={(value) => setTrainingForm((current) => ({ ...current, requestDate: value }))} />
            <label className="field"><span>Программа</span><select value={trainingForm.programName} onChange={(event) => {
              const programName = event.target.value;
              const hours = settings.trainingProgramHours?.[programName]?.[0] ?? "";
              setTrainingForm((current) => ({ ...current, programName, hours }));
            }}><option value="">Выберите программу</option>{settings.trainingPrograms.map((program) => <option key={program} value={program}>{program}</option>)}</select></label>
            <label className="field"><span>Вид обучения</span><input readOnly value={selectedProgramKind} /></label>
            {selectedProgramHours.length > 0
              ? <label className="field"><span>Количество часов</span><select value={trainingForm.hours} onChange={(event) => setTrainingForm((current) => ({ ...current, hours: event.target.value }))}>{selectedProgramHours.map((hours) => <option key={hours} value={hours}>{hours}</option>)}</select></label>
              : <ProfileField label="Количество часов" value={trainingForm.hours} onChange={(value) => setTrainingForm((current) => ({ ...current, hours: value }))} />}
          </div>
          <div className="form-grid two">
            <ProfileField label="Начало обучения" type="date" value={trainingForm.dateFrom} onChange={(value) => setTrainingForm((current) => ({ ...current, dateFrom: value }))} />
            <ProfileField label="Окончание обучения" type="date" value={trainingForm.dateTo} onChange={(value) => setTrainingForm((current) => ({ ...current, dateTo: value }))} />
          </div>
          <fieldset className="document-people-picker"><legend>Участники обучения</legend>{activePeople.map((person) => <label key={person.id}><input type="checkbox" checked={trainingSelected.includes(person.id)} onChange={() => toggleTrainingPerson(person.id)} /><span>{person.name}</span></label>)}</fieldset>
          {trainingSelected.length > 0 && <div className="table-scroll"><table className="training-edit-table"><thead><tr><th>Сотрудник</th><th>Дата рождения</th><th>Тип ВС</th><th>Должность</th><th>СНИЛС</th><th>Образование</th><th>Квалификация</th><th>Уровень</th><th>Паспорт</th></tr></thead><tbody>{trainingSelected.map((personId) => {
            const row = trainingRows[personId] ?? makeTrainingRow(personId);
            const update = (key: keyof TrainingRequestRow, value: string) => setTrainingRows((current) => ({ ...current, [personId]: { ...row, [key]: value } }));
            return <tr key={personId}>{(["personName", "birthDate", "aircraftType", "position", "snils", "educationDocument", "educationQualification", "educationLevel", "passport"] as const).map((key) => <td key={key}><input type={key === "birthDate" ? "date" : "text"} value={row[key]} onChange={(event) => update(key, event.target.value)} /></td>)}</tr>;
          })}</tbody></table></div>}
          <div className="form-grid two">
            <ProfileField label="E-mail отправителя" value={settings.senderEmail} onChange={(value) => onSettingsChange({ senderEmail: value })} />
            <ProfileField label="Телефон отправителя" value={settings.senderPhone} onChange={(value) => onSettingsChange({ senderPhone: value })} />
          </div>
          <div className="form-actions"><button className="primary-button" disabled={!trainingSelected.length} onClick={() => void runExport(() => downloadTrainingRequestWord({
            ...trainingForm,
            trainingCenterName: settings.trainingCenterName,
            trainingCenterHead: settings.trainingCenterHead,
            senderTitle: "Начальник штаба",
            senderName: company.chiefOfStaff,
            senderEmail: settings.senderEmail,
            senderPhone: settings.senderPhone,
            companyName: company.fullName || company.shortName,
            rows: trainingSelected.map((personId) => trainingRows[personId] ?? makeTrainingRow(personId)),
          }), "Заявка в АУЦ сформирована")}>Выгрузить в Word</button></div>
        </div>
      </article>}

      {formKind === "qualification" && <article className="panel documentation-workspace">
        <div className="panel-heading"><div><p className="eyebrow">PDF · 1/2 А5</p><h2>Вкладыш квалификационной проверки</h2></div></div>
        <div className="document-profile-form form-stack">
          <label className="field"><span>Сотрудник</span><select value={qualificationPersonId} onChange={(event) => {
            const personId = event.target.value;
            const person = activePeople.find((item) => item.id === personId);
            const aircraftType = person?.aircraftTypes[0] ?? "";
            setQualificationPersonId(personId);
            const seats = person?.qualifications.filter((item) => item.aircraftTypes.includes(aircraftType)).flatMap((item) => item.seats) ?? [];
            setQualificationForm((current) => ({ ...current, aircraftType, seat: seats[0] ?? "КВС" }));
          }}>{activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <div className="form-grid three">
            <label className="field"><span>Тип ВС</span><select value={qualificationForm.aircraftType} onChange={(event) => {
              const aircraftType = event.target.value;
              const person = activePeople.find((item) => item.id === qualificationPersonId);
              const seats = person?.qualifications.filter((item) => item.aircraftTypes.includes(aircraftType)).flatMap((item) => item.seats) ?? [];
              setQualificationForm((current) => ({ ...current, aircraftType, seat: seats[0] ?? "КВС" }));
            }}><option value="">Выберите тип ВС</option>{activePeople.find((item) => item.id === qualificationPersonId)?.aircraftTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
            <ProfileField label="Бортовой номер" value={qualificationForm.aircraftNumber} onChange={(value) => setQualificationForm((current) => ({ ...current, aircraftNumber: value }))} />
            <ProfileField label="Дата проверки" type="date" value={qualificationForm.checkDate} onChange={(value) => setQualificationForm((current) => ({ ...current, checkDate: value }))} />
          </div>
          <div className="form-grid three">
            <ProfileField label="Полётное время" value={qualificationForm.flightTime} onChange={(value) => setQualificationForm((current) => ({ ...current, flightTime: value }))} />
            <ProfileField label="Посадки" value={qualificationForm.landings} onChange={(value) => setQualificationForm((current) => ({ ...current, landings: value }))} />
            <ProfileField label="Место проверки" value={qualificationForm.checkPlace} onChange={(value) => setQualificationForm((current) => ({ ...current, checkPlace: value }))} />
          </div>
          <div className="form-grid three">
            <label className="field"><span>Квалификационная отметка</span><select value={qualificationForm.seat} onChange={(event) => setQualificationForm((current) => ({ ...current, seat: event.target.value }))}>{[...new Set(activePeople.find((item) => item.id === qualificationPersonId)?.qualifications.filter((item) => item.aircraftTypes.includes(qualificationForm.aircraftType)).flatMap((item) => item.seats) ?? ["КВС"])].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <ProfileField label="Проверяющий" value={qualificationForm.examinerName} onChange={(value) => setQualificationForm((current) => ({ ...current, examinerName: value }))} />
            <ProfileField label="№ свидетельства проверяющего" value={qualificationForm.examinerLicence} onChange={(value) => setQualificationForm((current) => ({ ...current, examinerLicence: value }))} />
          </div>
          <div className="report-scope-note"><strong>Результат:</strong> {qualificationResultText(qualificationForm.aircraftType, qualificationForm.seat)}</div>
          <label className="field"><span>Должность проверяющего</span><select value={qualificationForm.examinerRole} onChange={(event) => setQualificationForm((current) => ({ ...current, examinerRole: event.target.value }))}><option>Пилот-инструктор</option><option>Пилот-инструктор-экзаменатор</option></select></label>
          <div className="form-actions"><button className="primary-button" disabled={!qualificationPersonId} onClick={() => {
            const person = activePeople.find((item) => item.id === qualificationPersonId);
            if (!person) return;
            const selectedProfile = resolvedProfile(qualificationPersonId);
            void runExport(() => downloadQualificationCheckPdf({
              personName: person.name,
              licenceKind: selectedProfile.pilotLicenceKind,
              licenceNumber: selectedProfile.pilotLicenceNumber,
              ...qualificationForm,
            }), "Вкладыш проверки сформирован");
          }}>Выгрузить в PDF</button></div>
        </div>
      </article>}

      {formKind === "flight-certificate" && <article className="panel documentation-workspace">
        <div className="panel-heading"><div><p className="eyebrow">Word-документ</p><h2>Персональная справка о налёте</h2></div></div>
        <div className="document-profile-form form-stack">
          {!activePeople.length ? <div className="panel-empty">Добавьте сотрудников для формирования справки.</div> : <>
            <label className="field"><span>Сотрудник</span><select value={certificatePersonId} onChange={(event) => setCertificatePersonId(event.target.value)}>{activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
            <div className="form-grid two">
              <ProfileField label="Дата выдачи" type="date" value={certificateIssueDate} onChange={(value) => {
                setCertificateIssueDate(value);
                setCertificateNumber(nextRegistryNumber(registry, "certificate", value));
              }} />
              <ProfileField label="Номер справки из реестра" value={certificateNumber} onChange={setCertificateNumber} />
            </div>
            <div className="report-scope-note">ФИО и год рождения подставляются из личного дела. Общий налёт и налёт по типам ВС рассчитываются по актуальной лётной книжке сотрудника.</div>
            <div className="form-actions"><button className="primary-button" disabled={!certificatePersonId} onClick={() => {
              const person = activePeople.find((item) => item.id === certificatePersonId);
              if (!person) return;
              const flightBook = buildFlightBook(person.id, shifts, baselines, person.aircraftTypes);
              void runExport(() => downloadPersonalFlightCertificateWord({
                personName: person.name,
                birthDate: resolvedProfile(person.id).birthDate,
                issueDate: certificateIssueDate,
                certificateNumber,
                totalMinutes: flightBook.total.totalMinutes,
                rows: flightBook.rows.map((row) => ({
                  aircraftType: row.aircraftType,
                  totalMinutes: row.totalMinutes,
                })),
              }), "Персональная справка о налёте сформирована");
            }}>Выгрузить в Word</button></div>
          </>}
        </div>
      </article>}

      {formKind === "medical-referral" && <article className="panel documentation-workspace">
        <div className="panel-heading"><div><p className="eyebrow">Word-документ</p><h2>Направление на ВЛЭК</h2></div></div>
        <div className="document-profile-form form-stack">
          {!activePeople.length ? <div className="panel-empty">Добавьте сотрудника для формирования направления.</div> : <>
            <label className="field"><span>Сотрудник</span><select value={medicalPersonId} onChange={(event) => {
              const person = activePeople.find((item) => item.id === event.target.value);
              setMedicalPersonId(event.target.value);
              setMedicalForm((current) => ({ ...current, position: person?.position ?? "", division: person?.division ?? "" }));
            }}>{activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
            <div className="form-grid three">
              <ProfileField label="Дата выдачи" type="date" value={medicalForm.issueDate} onChange={(value) => setMedicalForm((current) => ({ ...current, issueDate: value }))} />
              <ProfileField label="№ направления" value={medicalForm.referralNumber} onChange={(value) => setMedicalForm((current) => ({ ...current, referralNumber: value }))} />
              <label className="field"><span>Вид освидетельствования</span><select value={medicalForm.examKind} onChange={(event) => setMedicalForm((current) => ({ ...current, examKind: event.target.value }))}><option value="предварительный">Предварительный</option><option value="периодический">Периодический</option></select></label>
            </div>
            <div className="form-grid two">
              <ProfileField label="Должность" value={medicalForm.position} onChange={(value) => setMedicalForm((current) => ({ ...current, position: value }))} />
              <ProfileField label="Подразделение" value={medicalForm.division} onChange={(value) => setMedicalForm((current) => ({ ...current, division: value }))} />
            </div>
            <div className="form-grid two">
              <label className="field"><span>Основание</span><select value={medicalForm.basis} onChange={(event) => setMedicalForm((current) => ({ ...current, basis: event.target.value }))}><option>Предварительный</option><option>Периодический (квартальный)</option><option>Периодический (полугодовой)</option><option>Периодический (годовой)</option><option>Осмотр после авиационного происшествия</option></select></label>
              <ProfileField label="ФИО и должность выдавшего" value={medicalForm.issuer} onChange={(value) => setMedicalForm((current) => ({ ...current, issuer: value }))} />
            </div>
            <label className="field"><span>Организация ВЛЭК</span><select value={medicalOrganizationId} onChange={(event) => setMedicalOrganizationId(event.target.value)}><option value="">Выберите из справочника</option>{settings.medicalOrganizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name || "Без наименования"}</option>)}</select></label>
            <div className="report-scope-note">Дата рождения берётся из личного дела. После формирования запись автоматически добавится в раздел «Медицинские направления» реестра.</div>
            <div className="form-actions"><button className="primary-button" disabled={!medicalPersonId || !medicalOrganizationId} onClick={() => {
              const person = activePeople.find((item) => item.id === medicalPersonId);
              const organization = settings.medicalOrganizations.find((item) => item.id === medicalOrganizationId);
              if (!person || !organization) return;
              const record: MedicalReferralRecord = { id: uid(), personName: person.name, position: medicalForm.position, division: medicalForm.division, basis: medicalForm.basis, number: medicalForm.referralNumber, issueDate: medicalForm.issueDate, issuer: medicalForm.issuer, createdAt: new Date().toISOString() };
              void runExport(async () => {
                await downloadMedicalReferralWord({ personName: person.name, birthDate: resolvedProfile(person.id).birthDate, position: medicalForm.position, division: medicalForm.division, issueDate: medicalForm.issueDate, referralNumber: medicalForm.referralNumber, examKind: medicalForm.examKind, medicalOrganizationName: organization.name, medicalOrganizationAddress: organization.address, medicalOrganizationOgrn: organization.ogrn });
                onUpsertMedicalReferral(record);
                setMedicalForm((current) => ({ ...current, referralNumber: nextMedicalReferralNumber([...medicalReferrals, record]) }));
              }, "Направление сформировано и добавлено в реестр");
            }}>Выгрузить в Word</button></div>
          </>}
        </div>
      </article>}
    </section>}

    {registryEditing && <RegistryModal
      record={registryEditing === "new" ? null : registryEditing}
      kind={registryKind === "medicalReferral" ? "order" : registryKind}
      records={registry}
      onClose={() => setRegistryEditing(null)}
      onSave={(record) => { onUpsertRegistry(record); setRegistryEditing(null); }}
      onDelete={registryEditing === "new" ? undefined : () => {
        if (window.confirm("Удалить запись из реестра?")) {
          onDeleteRegistry(registryEditing.id);
          setRegistryEditing(null);
        }
      }}
    />}
    {medicalEditing && <MedicalReferralModal
      record={medicalEditing === "new" ? null : medicalEditing}
      records={medicalReferrals}
      people={activePeople}
      onClose={() => setMedicalEditing(null)}
      onSave={(record) => { onUpsertMedicalReferral(record); setMedicalEditing(null); }}
      onDelete={medicalEditing === "new" ? undefined : () => {
        if (window.confirm("Удалить медицинское направление из реестра?")) {
          onDeleteMedicalReferral(medicalEditing.id);
          setMedicalEditing(null);
        }
      }}
    />}
  </section>;
}

function MedicalReferralTable({ records, query, year, onEdit }: { records: MedicalReferralRecord[]; query: string; year: string; onEdit: (record: MedicalReferralRecord) => void }) {
  const visible = records.filter((record) => (!year || record.issueDate.startsWith(year)) && `${record.number} ${record.personName} ${record.position} ${record.division} ${record.basis} ${record.issuer}`.toLocaleLowerCase("ru-RU").includes(query.trim().toLocaleLowerCase("ru-RU"))).sort((left, right) => `${right.issueDate}|${right.number}`.localeCompare(`${left.issueDate}|${left.number}`, "ru-RU"));
  if (!visible.length) return <div className="panel-empty tall">Медицинские направления по выбранному фильтру не найдены.</div>;
  return <div className="table-scroll"><table className="registry-table medical-registry-table"><thead><tr><th>№</th><th>Дата выдачи</th><th>Сотрудник</th><th>Должность</th><th>Подразделение</th><th>Основание</th><th>Выдал направление</th><th /></tr></thead><tbody>{visible.map((record) => <tr key={record.id}><td><strong>{record.number}</strong></td><td>{displayDate(record.issueDate)}</td><td>{record.personName}</td><td>{record.position || "—"}</td><td>{record.division || "—"}</td><td>{record.basis || "—"}</td><td>{record.issuer || "—"}</td><td><button className="row-action" onClick={() => onEdit(record)}>Изменить</button></td></tr>)}</tbody></table></div>;
}

function MedicalReferralModal({ record, records, people, onClose, onSave, onDelete }: { record: MedicalReferralRecord | null; records: MedicalReferralRecord[]; people: DocumentationPerson[]; onClose: () => void; onSave: (record: MedicalReferralRecord) => void; onDelete?: () => void }) {
  const [form, setForm] = useState<MedicalReferralRecord>(record ?? { id: uid(), personName: "", position: "", division: "", basis: "Периодический (годовой)", number: nextMedicalReferralNumber(records), issueDate: localIsoDate(), issuer: "", createdAt: new Date().toISOString() });
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal wide" role="dialog" aria-modal="true"><header><div><p className="eyebrow">Реестр ЛС</p><h2>{record ? "Изменить медицинское направление" : "Новое медицинское направление"}</h2></div><button className="modal-close" aria-label="Закрыть" onClick={onClose}>×</button></header><form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
    <label className="field"><span>Сотрудник</span><select required value={form.personName} onChange={(event) => { const person = people.find((item) => item.name === event.target.value); setForm((current) => ({ ...current, personName: event.target.value, position: person?.position ?? current.position, division: person?.division ?? current.division })); }}><option value="">Выберите сотрудника</option>{people.map((person) => <option key={person.id}>{person.name}</option>)}</select></label>
    <div className="form-grid three"><ProfileField label="Должность" value={form.position} onChange={(value) => setForm((current) => ({ ...current, position: value }))} /><ProfileField label="Подразделение" value={form.division} onChange={(value) => setForm((current) => ({ ...current, division: value }))} /><ProfileField label="Основание" value={form.basis} onChange={(value) => setForm((current) => ({ ...current, basis: value }))} /></div>
    <div className="form-grid two"><ProfileField label="№ направления" value={form.number} onChange={(value) => setForm((current) => ({ ...current, number: value }))} /><ProfileField label="Дата выдачи" type="date" value={form.issueDate} onChange={(value) => setForm((current) => ({ ...current, issueDate: value }))} /></div>
    <ProfileField label="ФИО и должность сотрудника, выдавшего направление" value={form.issuer} onChange={(value) => setForm((current) => ({ ...current, issuer: value }))} />
    <div className="form-actions split">{onDelete && <button type="button" className="danger-button" onClick={onDelete}>Удалить</button>}<span /><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button">Сохранить</button></div>
  </form></section></div>;
}

function ProfileField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="field"><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function RegistryModal({
  record,
  kind,
  records,
  onClose,
  onSave,
  onDelete,
}: {
  record: DocumentRegistryRecord | null;
  kind: DocumentRegistryKind;
  records: DocumentRegistryRecord[];
  onClose: () => void;
  onSave: (record: DocumentRegistryRecord) => void;
  onDelete?: () => void;
}) {
  const today = localIsoDate();
  const [form, setForm] = useState<DocumentRegistryRecord>(record ?? {
    id: uid(),
    kind,
    number: nextRegistryNumber(records, kind, today),
    date: today,
    subject: "",
    createdAt: new Date().toISOString(),
  });
  function updateKind(nextKind: DocumentRegistryKind) {
    setForm((current) => ({
      ...current,
      kind: nextKind,
      number: record ? current.number : nextRegistryNumber(records, nextKind, current.date),
    }));
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true"><header><div><p className="eyebrow">Реестр ЛС</p><h2>{record ? "Изменить запись" : "Новая запись"}</h2><span>Номер предлагается автоматически и доступен для исправления</span></div><button className="modal-close" aria-label="Закрыть" onClick={onClose}>×</button></header><form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
    <label className="field"><span>Раздел</span><select value={form.kind} onChange={(event) => updateKind(event.target.value as DocumentRegistryKind)}>{(Object.keys(registryKindLabels) as DocumentRegistryKind[]).map((item) => <option key={item} value={item}>{registryKindLabels[item]}</option>)}</select></label>
    <div className="form-grid two">
      <label className="field"><span>Номер</span><input required value={form.number} onChange={(event) => setForm((current) => ({ ...current, number: event.target.value }))} /></label>
      <label className="field"><span>Дата</span><input required type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value, number: record ? current.number : nextRegistryNumber(records, current.kind, event.target.value) }))} /></label>
    </div>
    <label className="field"><span>Содержание</span><textarea value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} /></label>
    <div className="form-actions split">{onDelete && <button type="button" className="danger-button" onClick={onDelete}>Удалить</button>}<span /><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button">Сохранить</button></div>
  </form></section></div>;
}
