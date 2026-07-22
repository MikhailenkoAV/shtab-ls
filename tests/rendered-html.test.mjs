import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildMonthlyFlightReport } from "../app/monthly-report.ts";

test("GitHub Pages export contains the main application sections", async () => {
  const html = await readFile(new URL("../out/index.html", import.meta.url), "utf8");
  assert.match(html, /Штаб ЛС/);
  assert.match(html, /Полётные смены/);
  assert.match(html, /Личные дела/);
});

test("monthly report aggregates total, night, aircraft type and purpose", () => {
  const report = buildMonthlyFlightReport(
    "2026-07",
    [{ id: "pilot", name: "Иванов Иван Иванович", position: "КВС", aircraftTypes: ["Ми-8"], active: true }],
    [{
      personId: "pilot",
      date: "2026-07-10",
      activity: "flight",
      segments: [{ aircraft: "RA-00001", aircraftType: "Ми-8", purpose: "АОН (УТП)", flightMinutes: 185, nightMinutes: 45 }],
    }],
  );
  const serialized = JSON.stringify(report);
  assert.match(serialized, /Иванов Иван Иванович/);
  assert.match(serialized, /Ми-8/);
  assert.match(serialized, /АОН \(УТП\)/);
  assert.match(serialized, /3:05/);
  assert.match(serialized, /0:45/);
});
