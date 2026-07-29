import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { buildQualificationCheckPdf } from "../app/document-exports.ts";
import { AUC_TRAINING_TEMPLATE_BASE64 } from "../app/auc-training-template-data.ts";
import { FLIGHT_CERTIFICATE_TEMPLATE_BASE64 } from "../app/flight-certificate-template-data.ts";

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
    result: "Зачёт",
    examinerName: "Петров Пётр Петрович",
    examinerLicence: "98765",
    examinerRole: "Пилот-инструктор",
  });
  assert.deepEqual(definition.pageSize, { width: 297.64, height: 419.53 });
  assert.match(JSON.stringify(definition), /Пилот-инструктор/);
  assert.match(JSON.stringify(definition), /RA-07338/);
});

test("approved Word templates keep the required alignment and certificate fields", async () => {
  const auc = await JSZip.loadAsync(AUC_TRAINING_TEMPLATE_BASE64, { base64: true });
  const aucXml = await auc.file("word/document.xml").async("string");
  const staffRow = [...aucXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)]
    .find((match) => match[0].includes("{{INDEX}}"))?.[0] ?? "";
  assert.match(staffRow, /w:jc w:val="center"/);
  assert.match(aucXml, /\{\{SENDER_NAME\}\}[\s\S]{0,1500}w:jc w:val="right"|w:jc w:val="right"[\s\S]{0,1500}\{\{SENDER_NAME\}\}/);
  assert.match(aucXml, /\{\{SENDER_SHORT\}\}/);

  const certificate = await JSZip.loadAsync(FLIGHT_CERTIFICATE_TEMPLATE_BASE64, { base64: true });
  const certificateXml = await certificate.file("word/document.xml").async("string");
  for (const token of ["PERSON_NAME", "BIRTH_YEAR", "TOTAL_HOURS", "AIRCRAFT_TYPE", "TYPE_HOURS"]) {
    assert.match(certificateXml, new RegExp(`\\{\\{${token}\\}\\}`));
  }
});
