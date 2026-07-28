import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  buildControlRows,
  compareAttentionDates,
  isControlAttention,
  isControlJournalVisible,
} from "../app/control-journal-rules.ts";

test("control journal creates 90-day type and night rows from the latest qualifying flight", () => {
  const people = [{
    id: "pilot",
    name: "Иванов Иван Иванович",
    active: true,
    qualifications: [{
      aircraftTypes: ["R44", "R66"],
      nightAircraftTypes: ["R44"],
    }],
  }];
  const shifts = [
    {
      personId: "pilot",
      date: "2026-07-01",
      activity: "flight",
      segments: [{ aircraft: "RA-04186", aircraftType: "R44", flightMinutes: 90, nightMinutes: 30, dayLandings: 1, nightLandings: 3 }],
    },
    {
      personId: "pilot",
      date: "2026-05-01",
      activity: "flight",
      segments: [{ aircraft: "RA-07375", aircraftType: "R66", flightMinutes: 60, nightMinutes: 0 }],
    },
  ];
  const rows = buildControlRows(people, shifts, [], "2026-07-26");
  const r44Type = rows.find((row) => row.kind === "type" && row.aircraftType === "R44");
  const r66Type = rows.find((row) => row.kind === "type" && row.aircraftType === "R66");
  const nightRows = rows.filter((row) => row.kind === "night");

  assert.equal(addDays("2026-07-01", 90), "2026-09-29");
  assert.equal(r44Type?.referenceDate, "2026-07-01");
  assert.equal(r44Type?.dueDate, "2026-09-29");
  assert.equal(r66Type?.status, "alert14");
  assert.equal(nightRows.length, 1);
  assert.equal(nightRows[0].aircraftType, "R44");
  assert.equal(nightRows[0].referenceDate, "2026-07-01");
  assert.equal(nightRows[0].landingCount, 3);
  assert.equal(isControlAttention(r44Type), false);
  assert.equal(isControlJournalVisible(r44Type, "type"), true);
  assert.equal(isControlJournalVisible(nightRows[0], "night"), true);
});

test("Bell407 board is recognized while types without a reference flight stay outside control", () => {
  const people = [{
    id: "bell",
    name: "Левочкин Виктор Викторович",
    active: true,
    qualifications: [{
      aircraftTypes: ["Bell407", "AW139"],
      nightAircraftTypes: ["Bell407"],
    }],
  }];
  const shifts = [{
    personId: "bell",
    date: "2026-07-21",
    activity: "flight",
    segments: [{ aircraft: "RA-01619", flightMinutes: 60, nightMinutes: 15, nightLandings: 3 }],
  }];
  const rows = buildControlRows(people, shifts, [], "2026-07-26");
  assert.equal(rows.find((row) => row.kind === "type" && row.aircraftType === "Bell407")?.referenceDate, "2026-07-21");
  assert.equal(rows.find((row) => row.kind === "night" && row.aircraftType === "Bell407")?.referenceDate, "2026-07-21");
  assert.equal(rows.find((row) => row.kind === "type" && row.aircraftType === "AW139")?.status, "incomplete");
  const aw139 = rows.find((row) => row.kind === "type" && row.aircraftType === "AW139");
  assert.equal(isControlAttention(aw139), false);
  assert.equal(isControlJournalVisible(aw139, "type"), false);
  assert.equal(rows.filter(isControlAttention).length, 0);
});

test("night control starts only after the third recorded night landing", () => {
  const people = [{
    id: "night",
    name: "Ночной Пилот",
    active: true,
    qualifications: [{ aircraftTypes: ["R44"], nightAircraftTypes: ["R44"] }],
  }];
  const shifts = [{
    personId: "night",
    date: "2026-07-20",
    activity: "flight",
    segments: [{ aircraft: "RA-04186", aircraftType: "R44", flightMinutes: 40, nightMinutes: 15, nightLandings: 2 }],
  }];
  const night = buildControlRows(people, shifts, [], "2026-07-26").find((row) => row.kind === "night");
  assert.equal(night?.referenceDate, "");
  assert.equal(night?.landingCount, 2);
  assert.equal(isControlAttention(night), false);
  assert.equal(isControlJournalVisible(night, "night"), false);
});

test("night validity is extended by the third most recent landing, not merely the latest night flight", () => {
  const people = [{
    id: "pilot",
    name: "Иванов Иван Иванович",
    active: true,
    qualifications: [{ aircraftTypes: ["AW109"], nightAircraftTypes: ["AW109"] }],
  }];
  const shifts = [
    { personId: "pilot", date: "2026-06-01", activity: "flight", segments: [{ aircraft: "RA-01902", aircraftType: "AW109", flightMinutes: 30, nightMinutes: 10, nightLandings: 1 }] },
    { personId: "pilot", date: "2026-06-15", activity: "flight", segments: [{ aircraft: "RA-01902", aircraftType: "AW109", flightMinutes: 30, nightMinutes: 10, nightLandings: 1 }] },
    { personId: "pilot", date: "2026-07-01", activity: "flight", segments: [{ aircraft: "RA-01902", aircraftType: "AW109", flightMinutes: 30, nightMinutes: 10, nightLandings: 2 }] },
  ];
  const night = buildControlRows(people, shifts, [], "2026-07-02")
    .find((row) => row.kind === "night");
  assert.equal(night?.landingCount, 4);
  assert.equal(night?.referenceDate, "2026-06-15");
  assert.equal(night?.dueDate, "2026-09-13");
});

test("certification dates are included and attention is ordered by nearest overdue then upcoming", () => {
  const people = [{
    id: "pilot",
    name: "Иванов Иван Иванович",
    active: true,
    qualifications: [],
  }];
  const certifications = [{
    id: "cert",
    personId: "pilot",
    category: "Сертификация",
    certificationType: "Медицинское заключение",
    aircraftType: "",
    issuedDate: "2025-08-10",
    startDate: "2025-08-10",
    endDate: "2026-08-10",
    organization: "ВЛЭК",
    documentType: "Заключение",
    number: "1",
  }];
  const rows = buildControlRows(people, [], certifications, "2026-07-26");
  assert.equal(rows[0].kind, "certification");
  assert.equal(rows[0].status, "alert45");
  assert.equal(rows[0].daysLeft, 15);
  assert.equal(isControlJournalVisible(rows[0], "certification"), true);
  assert.equal(isControlJournalVisible({ ...rows[0], status: "valid" }, "certification"), false);
  assert.ok(compareAttentionDates("2026-07-25", "2026-07-27", "2026-07-26") < 0);
  assert.ok(compareAttentionDates("2026-07-25", "2026-07-20", "2026-07-26") < 0);
});
