import assert from "node:assert/strict";
import test from "node:test";
import { buildFlightTaskOcr, sumFlightTaskLegs } from "../app/flight-task-import-rules.ts";

const people = [{
  id: "elnikov",
  name: "Ельников Егор Евгеньевич",
  position: "Командир ВС",
  aircraftTypes: ["R44", "R66"],
  qualifications: [{ aircraftTypes: ["R44"], seats: ["Командир ВС"] }],
  active: true,
}];

test("flight task OCR draft maps the sample R44 report to a confirmed shift", () => {
  const result = buildFlightTaskOcr({
    fileName: "23.08 р44 04186.pdf",
    page1: `ЗАДАНИЕ НА ПОЛЕТ № 5509
№ рейса/бортовой номер ВС: RA04186
Тип ВС: Robinson 44
Командир ВС: Ельников Егор Евгеньевич
Дата вылета: 23.08.2026
Цель полета: КВП`,
    page2: `ОТЧЕТ О РЕЙСЕ
23.08.26 ИП 540 - ИП 540 7.10 7.12 7.24 7.25 0.12 0.03 0.15 1
23.08.26 ИП 540 - ИП 540 8.00 8.02 8.14 8.15 0.12 0.03 0.15 1
23.08.26 ИП 540 - ИП 540 9.00 9.02 9.26 9.27 0.24 0.03 0.27 1
23.08.26 ИП 540 - ИП 540 13.00 13.02 13.26 13.27 0.24 0.03 0.27 1
23.08.26 ИП 540 - ИП 540 14.00 14.02 14.14 14.15 0.12 0.03 0.15 1
Продолжительность полетной смены
23.08.2026 6.00 14.45 8.45 1.00 1.39 5.26 0.10 0.30
Налет экипажа
Ельников Е.Е. R44 1.39 - - 5 -`,
  }, people);

  assert.equal(result.draft.personId, "elnikov");
  assert.equal(result.draft.date, "2026-08-23");
  assert.equal(result.draft.dutyStart, "06:00");
  assert.equal(result.draft.dutyEnd, "14:45");
  assert.equal(result.draft.aircraftType, "R44");
  assert.equal(result.draft.aircraft, "RA-04186");
  assert.equal(result.draft.purpose, "КВП");
  assert.equal(result.draft.legs.length, 5);
  assert.deepEqual(sumFlightTaskLegs(result.draft.legs), {
    flightMinutes: 99,
    nightMinutes: 0,
    dayLandings: 5,
    nightLandings: 0,
  });
});
