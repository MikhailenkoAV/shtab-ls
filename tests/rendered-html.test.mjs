import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildCumulativeFlightReport,
  buildEmploymentReport,
  buildFlightReport,
  buildSummaryFlightReport,
} from "../app/monthly-report.ts";

test("GitHub Pages export contains the main application sections", async () => {
  const html = await readFile(new URL("../out/index.html", import.meta.url), "utf8");
  assert.match(html, /ШТАБ ЛС/);
  assert.match(html, /Полётные смены/);
  assert.match(html, /Личные дела/);
  assert.match(html, /Контрольный журнал/);
  assert.match(html, /Месячный план/);
  assert.match(html, /Фактический план/);
  assert.match(html, /solaris-berassom-bg\.jpeg/);
  assert.match(html, /sidebar-icon\.png/);
  assert.match(html, /UTC/);
  assert.match(html, /Сочи/);
  assert.match(html, /Пермь/);
  assert.match(html, /Магадан/);
  assert.doesNotMatch(html, /\+ Сотрудник/);
  assert.doesNotMatch(html, /\+ Добавить смену/);
  assert.doesNotMatch(html, />Статус</);
});

test("period report aggregates chair, aircraft type, purpose, total and night flight time", () => {
  const report = buildFlightReport(
    "2026-06-15",
    "2026-07-20",
    [{ id: "pilot", name: "Иванов Иван Иванович", position: "Командир ВС", aircraftTypes: ["Ми-8"], active: true }],
    [
      { personId: "pilot", date: "2026-07-10", activity: "flight", segments: [{ aircraft: "RA-00001", aircraftType: "Ми-8", seat: "Пилот-инструктор", purpose: "АОН (УТП)", flightMinutes: 185, nightMinutes: 45, splitShift: true, splitGroupId: "split" }] },
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
  assert.match(serialized, /Бортовой №/);
  assert.match(serialized, /RA-00001/);
  assert.match(serialized, /РС/);
  assert.ok(serialized.includes("\"text\":\"+\""));
  assert.match(serialized, /Цель/);
  assert.match(serialized, /Налёт/);
  assert.match(serialized, /Из них ночь/);
  assert.match(serialized, /data:image\/png;base64,bG9nbw==/);
  assert.match(serialized, /3:05/);
  assert.match(serialized, /0:45/);
  assert.doesNotMatch(serialized, /10:00/);
});

test("monthly report contains every calendar day, aircraft types and flight-time columns", () => {
  const report = buildEmploymentReport(
    "2026-07-10",
    "2026-07-13",
    [{ id: "pilot", name: "Иванов Иван Иванович", position: "Командир ВС", aircraftTypes: ["AW139", "AS350"], active: true }],
    [
      { personId: "pilot", date: "2026-07-10", activity: "trip", workMinutes: 0, note: "Москва", segments: [] },
      {
        personId: "pilot",
        date: "2026-07-11",
        activity: "flight",
        workMinutes: 480,
        note: "Два полёта",
        segments: [
          { id: "one", aircraft: "RA-00001", aircraftType: "AW139", seat: "КВС", purpose: "АОН", dutyStart: "08:00", dutyEnd: "12:00", flightMinutes: 120, nightMinutes: 30 },
          { id: "two", aircraft: "RA-00002", aircraftType: "AS350", seat: "Пилот-инструктор", purpose: "КВП", dutyStart: "13:00", dutyEnd: "17:00", flightMinutes: 90, nightMinutes: 15, splitShift: true, splitGroupId: "split" },
        ],
      },
      { personId: "pilot", date: "2026-07-12", activity: "periodic_training", workMinutes: 480, note: "АУЦ", segments: [] },
    ],
    "pilot",
  );
  const serialized = JSON.stringify(report);
  assert.match(serialized, /Отчёт о занятости/);
  assert.match(serialized, /10\.07\.2026/);
  assert.match(serialized, /11\.07\.2026/);
  assert.match(serialized, /12\.07\.2026/);
  assert.match(serialized, /13\.07\.2026/);
  assert.match(serialized, /Командировка/);
  assert.match(serialized, /Периодическая подготовка/);
  assert.equal([...serialized.matchAll(/Полётная смена/g)].length, 2);
  assert.match(serialized, /AW139/);
  assert.match(serialized, /AS350/);
  assert.match(serialized, /RA-00001/);
  assert.match(serialized, /RA-00002/);
  assert.match(serialized, /Бортовой №/);
  assert.match(serialized, /РС/);
  assert.match(serialized, /Полётное время/);
  assert.match(serialized, /Из них инструктором/);
  assert.match(serialized, /Из них ночь/);
  assert.match(serialized, /3:30/);
  assert.match(serialized, /1:30/);
  assert.match(serialized, /0:45/);
  assert.match(serialized, /Нет записи/);
  assert.match(serialized, /8:00/);
  assert.match(serialized, /Москва/);
  assert.match(serialized, /ИТОГО ПО СОТРУДНИКУ/);
});

test("summary and cumulative reports use the requested flight totals", () => {
  const people = [{ id: "barkov", name: "Барков Сергей Владимирович", position: "Командир ВС", aircraftTypes: ["R44"], active: true }];
  const shifts = [
    { personId: "barkov", date: "2026-06-30", activity: "flight", segments: [{ aircraft: "RA-04186", aircraftType: "R44", seat: "КВС", purpose: "АОН", flightMinutes: 60, nightMinutes: 0 }] },
    { personId: "barkov", date: "2026-07-02", activity: "flight", segments: [{ aircraft: "RA-04186", aircraftType: "R44", seat: "Пилот-инструктор", purpose: "АОН (УТП)", flightMinutes: 90, nightMinutes: 30 }] },
  ];
  const cumulative = JSON.stringify(buildCumulativeFlightReport("2026-07-01", "2026-07-31", people, shifts, "barkov"));
  assert.match(cumulative, /Барков Сергей Владимирович/);
  assert.match(cumulative, /Отчёт по нарастающему налёту/);
  assert.match(cumulative, /2:30/);
  assert.match(cumulative, /1:30/);

  const summary = JSON.stringify(buildSummaryFlightReport("2026-07-01", "2026-07-31", people, shifts));
  assert.match(summary, /Итоговая справка о налёте/);
  assert.match(summary, /Барков Сергей Владимирович/);
  assert.match(summary, /R44/);
  assert.match(summary, /Инструктор/);
  assert.match(summary, /1:30/);
  assert.match(summary, /0:30/);
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
