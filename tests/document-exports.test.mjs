import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { buildQualificationCheckPdf, qualificationResultText } from "../app/document-exports.ts";
import { AUC_TRAINING_TEMPLATE_BASE64 } from "../app/auc-training-template-data.ts";
import { FLIGHT_CERTIFICATE_TEMPLATE_BASE64 } from "../app/flight-certificate-template-data.ts";
import { MEDICAL_REFERRAL_TEMPLATE_BASE64 } from "../app/medical-referral-template-data.ts";

test("qualification check insert is built as a half-A5 PDF page", () => {
  const definition = buildQualificationCheckPdf({
    personName: "Иванов Иван Иванович",
    licenceKind: "Свидетельство пилота",
    licenceNumber: "12345",
    aircraftType: "AS350",
    aircraftNumber: "RA-07338",
    flightTime: "1:20",
    landings: "3",
    checkDate: "2026-07-28",
    checkPlace: "Сочи",
    seat: "Пилот-инструктор",
    examinerName: "Петров Пётр Петрович",
    examinerLicence: "98765",
    examinerRole: "Пилот-инструктор",
  });
  assert.deepEqual(definition.pageSize, { width: 297.64, height: 419.53 });
  const serialized = JSON.stringify(definition);
  assert.match(serialized, /Пилот-инструктор/);
  assert.match(serialized, /RA-07338/);
  assert.match(serialized, /Уровень навыков управления вертолётом соответствует требованиям/);
  assert.match(serialized, /AS350, Инструктор AS350/);
  assert.equal((serialized.match(/Уровень навыков управления вертолётом соответствует требованиям/g) ?? []).length, 1);
  assert.doesNotMatch(serialized, /вкладыш в свидетельство авиационного специалиста/);
  assert.doesNotMatch(serialized, /Размер страницы/);
  assert.match(JSON.stringify(definition.background()), /"type":"rect"/);
});

test("qualification result is generated from aircraft type and selected seat", () => {
  assert.match(qualificationResultText("AW139", "КВС"), /\(AW139\)/);
  assert.match(qualificationResultText("AW139", "Пилот-инструктор"), /\(AW139, Инструктор AW139\)/);
  assert.match(qualificationResultText("AW139", "2-й пилот"), /\(AW139, Второй пилот AW139\)/);
});

test("approved Word templates keep the required alignment and certificate fields", async () => {
  const auc = await JSZip.loadAsync(AUC_TRAINING_TEMPLATE_BASE64, { base64: true });
  const aucXml = await auc.file("word/document.xml").async("string");
  const staffRow = [...aucXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)]
    .find((match) => match[0].includes("{{INDEX}}"))?.[0] ?? "";
  assert.match(staffRow, /w:jc w:val="center"/);
  assert.equal((aucXml.match(/\{\{SENDER_NAME\}\}/g) ?? []).length, 1);
  assert.match(aucXml, /\{\{SENDER_SHORT\}\}/);

  const certificate = await JSZip.loadAsync(FLIGHT_CERTIFICATE_TEMPLATE_BASE64, { base64: true });
  const certificateXml = await certificate.file("word/document.xml").async("string");
  for (const token of ["PERSON_NAME", "BIRTH_YEAR", "TOTAL_HOURS", "AIRCRAFT_TYPE", "TYPE_HOURS"]) {
    assert.match(certificateXml, new RegExp(`\\{\\{${token}\\}\\}`));
  }

  const medical = await JSZip.loadAsync(MEDICAL_REFERRAL_TEMPLATE_BASE64, { base64: true });
  const medicalXml = await medical.file("word/document.xml").async("string");
  for (const token of ["ISSUE_DATE", "REFERRAL_NUMBER", "VLEK_NAME", "VLEK_ADDRESS", "VLEK_OGRN", "EXAM_KIND", "PERSON_NAME", "BIRTH_DATE", "DIVISION", "POSITION"]) {
    assert.match(medicalXml, new RegExp(`\\{\\{${token}\\}\\}`));
  }
});
