import assert from "node:assert/strict";
import test from "node:test";
import { canonicalAircraftType } from "../app/aircraft-rules.ts";
import { operatorsForDocument } from "../app/personal-document-rules.ts";

test("Excel aircraft names resolve to the employee aircraft type", () => {
  assert.equal(canonicalAircraftType("Robinson 66"), "R66");
  assert.equal(canonicalAircraftType("Robinson R44"), "R44");
});

test("document operator falls back to all employee operators when imported type has no exact qualification", () => {
  const qualifications = [
    { aircraftTypes: ["R66"], operators: ["АОН"] },
    { aircraftTypes: ["A109"], operators: ["КВП"] },
  ];
  assert.deepEqual(operatorsForDocument(qualifications, "Robinson 66"), ["АОН"]);
  assert.deepEqual(operatorsForDocument(qualifications, "Неизвестный тип"), ["АОН", "КВП"]);
});
