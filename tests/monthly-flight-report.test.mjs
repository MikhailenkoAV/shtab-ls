import assert from "node:assert/strict";
import test from "node:test";
import { buildMonthlyFlightReport } from "../app/monthly-report.ts";
import { externalFlightsForReport } from "../app/external-flight-rules.ts";
import { expandLinkedCrewShifts } from "../app/crew-rules.ts";

const pilot = { id: "p", name: "Тестовый Пилот", position: "КВС", active: true, aircraftTypes: ["R44"] };
function segment(minutes, night = 0, extra = {}) {
  return { aircraft: "RA-04186", aircraftType: "R44", seat: "КВС", purpose: "КВП", flightMinutes: minutes, nightMinutes: night, ...extra };
}
function shift(date, segments, extra = {}) {
  return { personId: "p", date, activity: "flight", segments, ...extra };
}
function tables(node) {
  if (!node || typeof node !== "object") return [];
  return [...(node.table ? [node.table] : []), ...Object.values(node).flatMap((value) => Array.isArray(value) ? value.flatMap(tables) : tables(value))];
}
const monthlyTables = (doc) => tables(doc).filter((table) => table.body[0][0]?.text === "Месяц");
const totalRows = (table) => table.body.filter((row) => row[0]?.colSpan === 4);

test("monthly flight certificate spans years in chronological order and includes empty months and a period total", () => {
  const doc = buildMonthlyFlightReport("2026-12-01", "2027-02-28", [pilot], [shift("2026-12-10", [segment(90, 15)]), shift("2027-02-01", [segment(120, 30)])], "p");
  const [table] = monthlyTables(doc);
  assert.deepEqual(totalRows(table).map((row) => [row[0].text, row[4].text, row[5].text]), [
    ["Итого: Декабрь 2026", "1:30", "0:15"],
    ["Нет налёта: Январь 2027", "0:00", "0:00"],
    ["Итого: Февраль 2027", "2:00", "0:30"],
    ["ИТОГО ЗА ПЕРИОД", "3:30", "0:45"],
  ]);
});

test("each month combines all boards of a type while retaining separate purpose and seat", () => {
  const doc = buildMonthlyFlightReport("2026-09-01", "2026-10-31", [pilot], [
    shift("2026-09-01", [segment(60, 10), segment(90, 20, { aircraft: "RA-04359", purpose: " квп " })]),
    shift("2026-09-02", [segment(30, 0, { purpose: "АОН" }), segment(15, 5, { seat: "Пилот-инструктор" })]),
    shift("2026-10-01", [segment(20, 0)]),
  ], "p");
  const [table] = monthlyTables(doc);
  const septemberPicKvp = table.body.filter((r) => r[0].text === "Сентябрь 2026" && r[1].text === "КВС" && r[3].text === "КВП");
  assert.equal(septemberPicKvp.length, 1);
  assert.equal(septemberPicKvp[0][4].text, "2:30");
  assert.equal(septemberPicKvp[0][5].text, "0:30");
  assert.equal(table.body.filter((r) => r[0].text === "Сентябрь 2026").length, 3);
  assert.deepEqual(totalRows(table).map((r) => r[4].text), ["3:15", "0:20", "3:35"]);
  assert.doesNotMatch(JSON.stringify(doc), /RA-04186|RA-04359|Бортовой №/);
});

test("partial months include only selected dates and ignore nonflight activities", () => {
  const doc = buildMonthlyFlightReport("2026-09-15", "2026-10-10", [pilot], [
    shift("2026-09-14", [segment(100)]), shift("2026-09-15", [segment(20)]),
    shift("2026-10-10T12:00:00", [segment(30)]), shift("2026-10-11", [segment(200)]),
    shift("2026-09-20", [segment(300)], { activity: "office" }),
  ], "p");
  const [table] = monthlyTables(doc);
  assert.deepEqual(totalRows(table).map((r) => r[4].text), ["0:20", "0:30", "0:50"]);
  assert.match(JSON.stringify(doc), /В неполных месяцах учитываются только даты выбранного периода/);
});

test("additional flight certificates are credited to their own month, with boundary protection preserved", () => {
  const external = { id: "cert", personId: "p", month: "2026-09", aircraftType: "R44", aircraft: "RA-04359", seat: "КВС", purpose: "КВП", flightMinutes: 150, nightMinutes: 20, source: "Проверка", note: "", createdAt: "" };
  const externalShifts = externalFlightsForReport([external], "2026-09-01", "2026-10-31");
  const doc = buildMonthlyFlightReport("2026-09-01", "2026-10-31", [pilot], [shift("2026-09-01", [segment(30, 10)]), ...externalShifts, shift("2026-10-01", [segment(60)])], "p");
  assert.deepEqual(totalRows(monthlyTables(doc)[0]).map((r) => [r[4].text, r[5].text]), [["3:00", "0:30"], ["1:00", "0:00"], ["4:00", "0:30"]]);
  assert.throws(() => externalFlightsForReport([external], "2026-09-15", "2026-10-31"), /Справка.*Уточните даты/);
});

test("overall certificate sums employee flight hours and includes archived staff with historical flights", () => {
  const second = { ...pilot, id: "q", name: "Второй Пилот", active: false };
  const absent = { ...pilot, id: "absent", name: "Не включать", active: false };
  const shifts = [shift("2026-09-10", [segment(60, 10)]), shift("2026-10-10", [segment(120, 20)], { personId: "q" })];
  const doc = buildMonthlyFlightReport("2026-09-01", "2026-10-31", [pilot, second, absent], shifts);
  const all = monthlyTables(doc);
  assert.equal(all.length, 3); // overall + two people
  assert.deepEqual(totalRows(all[0]).map((r) => r[4].text), ["1:00", "2:00", "3:00"]);
  assert.equal(all.slice(1).reduce((minutes, t) => {
    const [h, m] = t.body.at(-1)[4].text.split(":").map(Number);
    return minutes + h * 60 + m;
  }, 0), 180);
  assert.match(JSON.stringify(doc), /Второй Пилот/);
  assert.doesNotMatch(JSON.stringify(doc), /Не включать/);
  assert.equal(monthlyTables(buildMonthlyFlightReport("2026-09-01", "2026-10-31", [pilot, second], shifts, "q")).length, 1);
});

test("shared crew minutes are preserved in individual monthly certificates and all table rows have six cells", () => {
  const shifts = expandLinkedCrewShifts([shift("2026-10-01", [segment(75, 15, { seat: "Пилот-инструктор", commanderPersonId: "q", dutyStart: "08:00", dutyEnd: "10:00" })], { id: "shared" })]);
  const second = { ...pilot, id: "q", name: "Второй Пилот" };
  for (const id of ["p", "q"]) {
    const doc = buildMonthlyFlightReport("2026-10-01", "2026-10-31", [pilot, second], shifts, id);
    const [table] = monthlyTables(doc);
    assert.equal(table.body.at(-1)[4].text, "1:15");
    assert.equal(table.body.at(-1)[5].text, "0:15");
    assert.ok(table.body.every((r) => r.length === 6));
    assert.equal(table.headerRows, 1);
    assert.equal(table.dontBreakRows, true);
  }
});
