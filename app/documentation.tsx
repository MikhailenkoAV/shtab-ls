"use client";

import { useMemo, useState } from "react";
import {
  downloadPilotAppendixWord,
  downloadQualificationCheckPdf,
  downloadTrainingRequestWord,
  TrainingRequestRow,
} from "./document-exports";
import {
  DocumentPersonProfile,
  DocumentRegistryKind,
  DocumentRegistryRecord,
  DocumentSettings,
  EMPTY_DOCUMENT_PROFILE,
  nextRegistryNumber,
  registryKindLabels,
} from "./documentation-rules";

type DocumentationPerson = {
  id: string;
  name: string;
  position: string;
  aircraftTypes: string[];
  active: boolean;
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

type DocumentationTab = "registry" | "forms" | "profiles" | "references";
type FormKind = "pilot" | "training" | "qualification";
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
  registry,
  profiles,
  settings,
  company,
  onUpsertRegistry,
  onDeleteRegistry,
  onProfileChange,
  onSettingsChange,
  onNotify,
}: {
  people: DocumentationPerson[];
  certifications: DocumentationCertification[];
  registry: DocumentRegistryRecord[];
  profiles: Record<string, DocumentPersonProfile>;
  settings: DocumentSettings;
  company: DocumentationCompany;
  onUpsertRegistry: (record: DocumentRegistryRecord) => void;
  onDeleteRegistry: (recordId: string) => void;
  onProfileChange: (personId: string, profile: DocumentPersonProfile) => void;
  onSettingsChange: (patch: Partial<DocumentSettings>) => void;
  onNotify: (message: string) => void;
}) {
  const activePeople = useMemo(
    () => people.filter((person) => person.active).sort((left, right) => left.name.localeCompare(right.name, "ru-RU")),
    [people],
  );
  const [tab, setTab] = useState<DocumentationTab>("registry");
  const [formKind, setFormKind] = useState<FormKind>("pilot");
  const [registryKind, setRegistryKind] = useState<DocumentRegistryKind>("order");
  const [registryQuery, setRegistryQuery] = useState("");
  const [registryYear, setRegistryYear] = useState("");
  const [registryEditing, setRegistryEditing] = useState<DocumentRegistryRecord | "new" | null>(null);
  const years = useMemo(() => [...new Set(registry.map((record) => record.date.slice(0, 4)).filter(Boolean))].sort().reverse(), [registry]);
  const visibleRegistry = useMemo(() => registry.filter((record) =>
    record.kind === registryKind
    && (!registryYear || record.date.startsWith(registryYear))
    && `${record.number} ${record.subject}`.toLocaleLowerCase("ru-RU")
      .includes(registryQuery.trim().toLocaleLowerCase("ru-RU")))
    .sort((left, right) => `${right.date}|${right.number}`.localeCompare(`${left.date}|${left.number}`, "ru-RU")),
  [registry, registryKind, registryQuery, registryYear]);

  const [profilePersonId, setProfilePersonId] = useState(activePeople[0]?.id ?? "");
  const selectedProfilePersonId = activePeople.some((person) => person.id === profilePersonId)
    ? profilePersonId
    : activePeople[0]?.id ?? "";
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
  const profile = resolvedProfile(selectedProfilePersonId);

  const [pilotPersonId, setPilotPersonId] = useState(activePeople[0]?.id ?? "");
  const [pilotIssueDate, setPilotIssueDate] = useState(localIsoDate());
  const [pilotOperator, setPilotOperator] = useState(company.shortName || company.fullName);
  const [pilotSignatory, setPilotSignatory] = useState(company.chiefOfStaff);
  const [pilotLicenceKind, setPilotLicenceKind] = useState(() => resolvedProfile(activePeople[0]?.id ?? "").pilotLicenceKind);
  const [pilotLicenceNumber, setPilotLicenceNumber] = useState(() => resolvedProfile(activePeople[0]?.id ?? "").pilotLicenceNumber);

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
    result: "Зачёт",
    examinerName: "",
    examinerLicence: "",
    examinerRole: "Пилот-инструктор",
  });
  const selectedProgramHours = settings.trainingProgramHours?.[trainingForm.programName] ?? [];

  function updateTrainingProgram(index: number, nextName: string) {
    const previousName = settings.trainingPrograms[index];
    const trainingPrograms = settings.trainingPrograms.map((item, itemIndex) =>
      itemIndex === index ? nextName : item);
    const trainingProgramHours = { ...(settings.trainingProgramHours ?? {}) };
    if (previousName !== nextName) {
      trainingProgramHours[nextName] = trainingProgramHours[previousName] ?? [];
      delete trainingProgramHours[previousName];
    }
    onSettingsChange({ trainingPrograms, trainingProgramHours });
  }

  function deleteTrainingProgram(index: number) {
    const name = settings.trainingPrograms[index];
    const trainingProgramHours = { ...(settings.trainingProgramHours ?? {}) };
    delete trainingProgramHours[name];
    onSettingsChange({
      trainingPrograms: settings.trainingPrograms.filter((_, itemIndex) => itemIndex !== index),
      trainingProgramHours,
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
      <button className={tab === "forms" ? "active" : ""} onClick={() => setTab("forms")}><strong>Формирование</strong><small>Word и PDF</small></button>
      <button className={tab === "profiles" ? "active" : ""} onClick={() => setTab("profiles")}><strong>Анкетные данные</strong><small>Для автозаполнения</small></button>
      <button className={tab === "references" ? "active" : ""} onClick={() => setTab("references")}><strong>Справочники</strong><small>АУЦ и программы</small></button>
    </nav>

    {tab === "registry" && <section className="panel documentation-workspace">
      <div className="panel-heading"><div><p className="eyebrow">Реестр ЛС</p><h2>{registryKindLabels[registryKind]}</h2></div><button className="primary-button" onClick={() => setRegistryEditing("new")}>+ Новая запись</button></div>
      <div className="registry-kind-tabs">{(Object.keys(registryKindLabels) as DocumentRegistryKind[]).map((kind) =>
        <button key={kind} className={registryKind === kind ? "active" : ""} onClick={() => setRegistryKind(kind)}><span>{registryKindLabels[kind]}</span><i>{registry.filter((record) => record.kind === kind).length}</i></button>)}</div>
      <div className="records-toolbar registry-toolbar">
        <input value={registryQuery} onChange={(event) => setRegistryQuery(event.target.value)} placeholder="Поиск по номеру или содержанию…" />
        <select value={registryYear} onChange={(event) => setRegistryYear(event.target.value)}><option value="">Все годы</option>{years.map((year) => <option key={year}>{year}</option>)}</select>
      </div>
      {!visibleRegistry.length ? <div className="panel-empty tall">Записи по выбранному фильтру не найдены.</div> : <div className="table-scroll"><table className="registry-table"><thead><tr><th>Номер</th><th>Дата</th><th>Содержание</th><th /></tr></thead><tbody>{visibleRegistry.map((record) =>
        <tr key={record.id}><td><strong>{record.number || "—"}</strong></td><td>{displayDate(record.date)}</td><td className="note-cell">{record.subject || "—"}</td><td><button className="row-action" onClick={() => setRegistryEditing(record)}>Изменить</button></td></tr>)}</tbody></table></div>}
    </section>}

    {tab === "profiles" && <section className="panel documentation-workspace">
      <div className="panel-heading"><div><p className="eyebrow">Внутренняя база</p><h2>Анкетные данные сотрудника</h2></div><span className="settings-auto-save">Сохраняется автоматически</span></div>
      {!activePeople.length ? <div className="panel-empty tall">Сначала добавьте сотрудников в разделе «Сотрудники».</div> : <div className="document-profile-form form-stack">
        <label className="field"><span>Сотрудник</span><select value={selectedProfilePersonId} onChange={(event) => setProfilePersonId(event.target.value)}>{activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <div className="form-grid three">
          <ProfileField label="Дата рождения" type="date" value={profile.birthDate} onChange={(value) => onProfileChange(selectedProfilePersonId, { ...profile, birthDate: value })} />
          <ProfileField label="Вид свидетельства" value={profile.pilotLicenceKind} onChange={(value) => onProfileChange(selectedProfilePersonId, { ...profile, pilotLicenceKind: value })} />
          <ProfileField label="Номер свидетельства" value={profile.pilotLicenceNumber} onChange={(value) => onProfileChange(selectedProfilePersonId, { ...profile, pilotLicenceNumber: value })} />
        </div>
        <div className="form-grid three">
          <ProfileField label="СНИЛС" value={profile.snils} onChange={(value) => onProfileChange(selectedProfilePersonId, { ...profile, snils: value })} />
          <ProfileField label="Серия паспорта" value={profile.passportSeries} onChange={(value) => onProfileChange(selectedProfilePersonId, { ...profile, passportSeries: value })} />
          <ProfileField label="Номер паспорта" value={profile.passportNumber} onChange={(value) => onProfileChange(selectedProfilePersonId, { ...profile, passportNumber: value })} />
        </div>
        <div className="form-grid two">
          <ProfileField label="Серия документа об образовании" value={profile.educationDocumentSeries} onChange={(value) => onProfileChange(selectedProfilePersonId, { ...profile, educationDocumentSeries: value })} />
          <ProfileField label="Номер документа об образовании" value={profile.educationDocumentNumber} onChange={(value) => onProfileChange(selectedProfilePersonId, { ...profile, educationDocumentNumber: value })} />
        </div>
        <div className="form-grid two">
          <ProfileField label="Квалификация / специальность" value={profile.educationQualification} onChange={(value) => onProfileChange(selectedProfilePersonId, { ...profile, educationQualification: value })} />
          <ProfileField label="Уровень образования" value={profile.educationLevel} onChange={(value) => onProfileChange(selectedProfilePersonId, { ...profile, educationLevel: value })} />
        </div>
        <div className="form-grid two">
          <ProfileField label="E-mail" value={profile.email} onChange={(value) => onProfileChange(selectedProfilePersonId, { ...profile, email: value })} />
          <ProfileField label="Телефон" value={profile.phone} onChange={(value) => onProfileChange(selectedProfilePersonId, { ...profile, phone: value })} />
        </div>
      </div>}
    </section>}

    {tab === "references" && <section className="panel documentation-workspace">
      <div className="panel-heading"><div><p className="eyebrow">Справочники форм</p><h2>АУЦ и программы обучения</h2></div><span className="settings-auto-save">Сохраняется автоматически</span></div>
      <div className="document-profile-form form-stack">
        <div className="form-grid two">
          <ProfileField label="Наименование АУЦ" value={settings.trainingCenterName} onChange={(value) => onSettingsChange({ trainingCenterName: value })} />
          <ProfileField label="Руководитель / адресат" value={settings.trainingCenterHead} onChange={(value) => onSettingsChange({ trainingCenterHead: value })} />
        </div>
        <div className="training-program-settings">
          <div className="training-program-settings-head"><strong>Программы и количество часов</strong><button className="secondary-button compact" type="button" onClick={() => onSettingsChange({ trainingPrograms: [...settings.trainingPrograms, "Новая программа"] })}>+ Добавить программу</button></div>
          {settings.trainingPrograms.map((program, index) => <article key={`${program}-${index}`}>
            <label className="field"><span>Наименование программы</span><input value={program} onChange={(event) => updateTrainingProgram(index, event.target.value)} /></label>
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
        ["pilot", "Приложение к пилотскому", "Word · данные личного дела"],
        ["training", "Заявка в АУЦ", "Word · ручная проверка полей"],
        ["qualification", "Вкладыш проверки", "PDF · формат 1/2 А5"],
      ] as const).map(([kind, title, detail]) => <button key={kind} className={formKind === kind ? "active" : ""} onClick={() => setFormKind(kind)}><strong>{title}</strong><small>{detail}</small></button>)}
      </aside>

      {formKind === "pilot" && <article className="panel documentation-workspace">
        <div className="panel-heading"><div><p className="eyebrow">Word-документ</p><h2>Приложение к пилотскому свидетельству</h2></div></div>
        <div className="document-profile-form form-stack">
          {!activePeople.length ? <div className="panel-empty">Добавьте сотрудников для формирования документа.</div> : <>
            <label className="field"><span>Сотрудник</span><select value={pilotPersonId} onChange={(event) => {
              const personId = event.target.value;
              const nextProfile = resolvedProfile(personId);
              setPilotPersonId(personId);
              setPilotLicenceKind(nextProfile.pilotLicenceKind);
              setPilotLicenceNumber(nextProfile.pilotLicenceNumber);
            }}>{activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
            <div className="form-grid three">
              <ProfileField label="Дата оформления" type="date" value={pilotIssueDate} onChange={setPilotIssueDate} />
              <ProfileField label="Эксплуатант" value={pilotOperator} onChange={setPilotOperator} />
              <ProfileField label="Подписант" value={pilotSignatory} onChange={setPilotSignatory} />
            </div>
            <div className="form-grid two">
              <ProfileField label="Вид свидетельства" value={pilotLicenceKind} onChange={setPilotLicenceKind} />
              <ProfileField label="Номер свидетельства" value={pilotLicenceNumber} onChange={setPilotLicenceNumber} />
            </div>
            <AutofillStatus profile={resolvedProfile(pilotPersonId)} />
            <div className="form-actions"><button className="primary-button" onClick={() => {
              const person = activePeople.find((item) => item.id === pilotPersonId);
              if (!person) return;
              void runExport(() => downloadPilotAppendixWord({
                personName: person.name,
                profile: { ...resolvedProfile(pilotPersonId), pilotLicenceKind, pilotLicenceNumber },
                issueDate: pilotIssueDate,
                operator: pilotOperator,
                signatory: pilotSignatory,
                certifications: certifications.filter((record) => record.personId === pilotPersonId),
              }), "Приложение сформировано");
            }}>Выгрузить в Word</button></div>
          </>}
        </div>
      </article>}

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
            setQualificationPersonId(personId);
            setQualificationForm((current) => ({ ...current, aircraftType: activePeople.find((person) => person.id === personId)?.aircraftTypes[0] ?? "" }));
          }}>{activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <div className="form-grid three">
            <ProfileField label="Тип ВС" value={qualificationForm.aircraftType} onChange={(value) => setQualificationForm((current) => ({ ...current, aircraftType: value }))} />
            <ProfileField label="Бортовой номер" value={qualificationForm.aircraftNumber} onChange={(value) => setQualificationForm((current) => ({ ...current, aircraftNumber: value }))} />
            <ProfileField label="Дата проверки" type="date" value={qualificationForm.checkDate} onChange={(value) => setQualificationForm((current) => ({ ...current, checkDate: value }))} />
          </div>
          <div className="form-grid three">
            <ProfileField label="Полётное время" value={qualificationForm.flightTime} onChange={(value) => setQualificationForm((current) => ({ ...current, flightTime: value }))} />
            <ProfileField label="Посадки" value={qualificationForm.landings} onChange={(value) => setQualificationForm((current) => ({ ...current, landings: value }))} />
            <ProfileField label="Место проверки" value={qualificationForm.checkPlace} onChange={(value) => setQualificationForm((current) => ({ ...current, checkPlace: value }))} />
          </div>
          <div className="form-grid three">
            <ProfileField label="Результат" value={qualificationForm.result} onChange={(value) => setQualificationForm((current) => ({ ...current, result: value }))} />
            <ProfileField label="Проверяющий" value={qualificationForm.examinerName} onChange={(value) => setQualificationForm((current) => ({ ...current, examinerName: value }))} />
            <ProfileField label="№ свидетельства проверяющего" value={qualificationForm.examinerLicence} onChange={(value) => setQualificationForm((current) => ({ ...current, examinerLicence: value }))} />
          </div>
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
    </section>}

    {registryEditing && <RegistryModal
      record={registryEditing === "new" ? null : registryEditing}
      kind={registryKind}
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
  </section>;
}

function ProfileField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="field"><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function AutofillStatus({ profile }: { profile: DocumentPersonProfile }) {
  const missing = [
    !profile.pilotLicenceNumber && "номер свидетельства",
    !profile.birthDate && "дата рождения",
  ].filter(Boolean);
  return <div className={`autofill-status ${missing.length ? "warning" : "ready"}`}><strong>{missing.length ? "Нужно проверить данные" : "Данные готовы"}</strong><span>{missing.length ? `Не заполнено: ${missing.join(", ")}. Документ всё равно можно сформировать.` : "Основные поля будут взяты из анкетных данных и личного дела."}</span></div>;
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
