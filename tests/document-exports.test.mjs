import assert from "node:assert/strict";
import test from "node:test";
import { buildQualificationCheckPdf } from "../app/document-exports.ts";

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
