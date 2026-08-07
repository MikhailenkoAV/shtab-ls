import assert from "node:assert/strict";
import test from "node:test";
import { buildAnalyticsReport } from "../app/analytics-report.ts";
import { canonicalAircraft, typeSpecificTraining } from "../app/training-matrix-rules.ts";

test("training matrix distinguishes type-specific and common preparation", () => {
  assert.equal(typeSpecificTraining("Квалификационная проверка КВС"), true);
  assert.equal(typeSpecificTraining("КПК на типе ВС"), true);
  assert.equal(typeSpecificTraining("Авиационная безопасность"), false);
  assert.equal(typeSpecificTraining("Человеческий фактор"), false);
  assert.equal(canonicalAircraft("Bell 407"), canonicalAircraft("Bell407"));
});

test("analytics PDF contains factual metrics without plan completion", () => {
  const report = buildAnalyticsReport({
    from: "2026-08-01", to: "2026-08-31", totalFlight: 125, flightShifts: 3,
    training: 2, warnings: 1,
    rows: [{ name: "Иванов Иван Иванович", shifts: 3, work: 600, flight: 125, night: 25 }],
  });
  const serialized = JSON.stringify(report);
  assert.match(serialized, /УПРАВЛЕНЧЕСКАЯ СВОДКА/);
  assert.match(serialized, /Иванов Иван Иванович/);
  assert.doesNotMatch(serialized, /План выполнен|План \/ факт/);
});
