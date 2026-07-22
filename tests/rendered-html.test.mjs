import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildEmploymentReport, buildFlightReport } from "../app/monthly-report.ts";

test("GitHub Pages export contains the main application sections", async () => {
  const html = await readFile(new URL("../out/index.html", import.meta.url), "utf8");
  assert.match(html, /Штаб ЛС/);
  assert.match(html, /Полётные смены/);
  assert.match(html, /Личные дела/);
  assert.match(html, /solaris-airfield-bg\.jpg/);
  assert.doesNotMatch(html, />Статус</);
});

test("period report aggregates chair, aircraft type, purpose, total and night flight time", () => {
  const report = buildFlightReport(
    "2026-06-15",
    "2026-07-20",
    [{ id: "pilot", name: "Иванов Иван Иванович", position: "Командир ВС", aircraftTypes: ["Ми-8"], active: true }],
    [
      { personId: "pilot", date: "2026-07-10", activity: "flight", segments: [{ aircraft: "RA-00001", aircraftType: "Ми-8", seat: "Пилот-инструктор", purpose: "АОН (УТП)", flightMinutes: 185, nightMinutes: 45 }] },
      { personId: "pilot", date: "2026-08-01", activity: "flight", segments: [{ aircraft: "RA-00001", aircraftType: "Ми-8", seat: "КВС", purpose: "АОН", flightMinutes: 600, nightMinutes: 0 }] },
    ],
    "pilot",
    "data:image/png;base64,bG9nbw==",
  );
  const serialized = JSON.stringify(report);
  assert.match(serialized, /Иванов Иван Иванович/);
  assert.match(serialized, /15\.06\.2026 - 20\.07\.2026/);
  assert.match(serialized, /Ми-8/);
  assert.match(serialized, /Пилот-инструктор/);
  assert.match(serialized, /АОН \(УТП\)/);
  assert.match(serialized, /Кресло/);
  assert.match(serialized, /Тип ВС/);
  assert.match(serialized, /Цель/);
  assert.match(serialized, /Налёт/);
  assert.match(serialized, /Из них ночь/);
  assert.match(serialized, /data:image\/png;base64,bG9nbw==/);
  assert.match(serialized, /3:05/);
  assert.match(serialized, /0:45/);
  assert.doesNotMatch(serialized, /10:00/);
});

test("daily employment report contains every calendar day and all activity details", () => {
  const report = buildEmploymentReport(
    "2026-07-10",
    "2026-07-12",
    [{ id: "pilot", name: "Иванов Иван Иванович", position: "Командир ВС", aircraftTypes: ["Ми-8"], active: true }],
    [
      { personId: "pilot", date: "2026-07-10", activity: "trip", workMinutes: 0, note: "Москва", segments: [] },
      { personId: "pilot", date: "2026-07-12", activity: "periodic_training", workMinutes: 480, note: "АУЦ", segments: [] },
    ],
    "pilot",
  );
  const serialized = JSON.stringify(report);
  assert.match(serialized, /10\.07\.2026/);
  assert.match(serialized, /11\.07\.2026/);
  assert.match(serialized, /12\.07\.2026/);
  assert.match(serialized, /Командировка/);
  assert.match(serialized, /Периодическая подготовка/);
  assert.match(serialized, /Нет записи/);
  assert.match(serialized, /8:00/);
  assert.match(serialized, /Москва/);
});

test("overall report includes a shared summary and individual employees", () => {
  const people = [
    { id: "one", name: "Иванов Иван Иванович", position: "Командир ВС", aircraftTypes: ["Ми-8"], active: true },
    { id: "two", name: "Петров Пётр Петрович", position: "Пилот-инструктор", aircraftTypes: ["Ми-2"], active: true },
  ];
  const shifts = [
    { personId: "one", date: "2026-07-10", activity: "flight", segments: [{ aircraft: "RA-1", aircraftType: "Ми-8", purpose: "АОН", flightMinutes: 120, nightMinutes: 30 }] },
    { personId: "two", date: "2026-07-11", activity: "flight", segments: [{ aircraft: "RA-2", aircraftType: "Ми-2", purpose: "КВП", flightMinutes: 60, nightMinutes: 0 }] },
  ];
  const overall = JSON.stringify(buildFlightReport("2026-07-01", "2026-07-31", people, shifts));
  assert.match(overall, /Общий итог по всем сотрудникам/);
  assert.match(overall, /3:00/);
  assert.match(overall, /Иванов Иван Иванович/);
  assert.match(overall, /Петров Пётр Петрович/);

  const individual = JSON.stringify(buildFlightReport("2026-07-01", "2026-07-31", people, shifts, "one"));
  assert.match(individual, /Иванов Иван Иванович/);
  assert.doesNotMatch(individual, /Петров Пётр Петрович/);
});
