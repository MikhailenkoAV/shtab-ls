import assert from "node:assert/strict";
import test from "node:test";
import {
  aircraftNumbersForType,
  canonicalAircraftType,
  isAircraftNumberAllowed,
} from "../app/aircraft-rules.ts";

test("aircraft types expose only their assigned registration numbers", () => {
  assert.deepEqual([...aircraftNumbersForType("AW109")], ["RA-01902"]);
  assert.deepEqual([...aircraftNumbersForType("AW139")], ["RA-01697"]);
  assert.deepEqual([...aircraftNumbersForType("A109")], ["RA-07701"]);
  assert.deepEqual([...aircraftNumbersForType("BO105")], ["RA-02549", "RA-2991G"]);
  assert.deepEqual([...aircraftNumbersForType("R66")], ["RA-07375", "RA-05828"]);
  assert.deepEqual([...aircraftNumbersForType("R44")], ["RA-04186", "RA-04359"]);
  assert.deepEqual([...aircraftNumbersForType("AS350")], ["RA-07338", "RA-04063"]);
  assert.deepEqual([...aircraftNumbersForType("Bell407")], ["RA-01619"]);
});

test("Bell 407 and Bell407 use one canonical aircraft type", () => {
  assert.equal(canonicalAircraftType("Bell 407"), "Bell407");
  assert.equal(canonicalAircraftType("Bell407"), "Bell407");
  assert.equal(canonicalAircraftType("BO-105"), "BO105");
  assert.equal(canonicalAircraftType("AS350 B3"), "AS350");
  assert.equal(canonicalAircraftType("Robinson 66"), "R66");
  assert.equal(canonicalAircraftType("Robinson 44"), "R44");
  assert.deepEqual([...aircraftNumbersForType("Bell 407")], ["RA-01619"]);
});

test("a registration number cannot be saved for another mapped aircraft type", () => {
  assert.equal(isAircraftNumberAllowed("AW109", "RA-01902"), true);
  assert.equal(isAircraftNumberAllowed("AW109", "RA-07701"), false);
  assert.equal(isAircraftNumberAllowed("BO105", ""), false);
  assert.equal(isAircraftNumberAllowed("AW139", "RA-01697"), true);
  assert.equal(isAircraftNumberAllowed("AW139", "RA-00000"), false);
});

test("unmapped aircraft types keep existing imported registration numbers", () => {
  assert.deepEqual([...aircraftNumbersForType("EC130")], []);
  assert.equal(isAircraftNumberAllowed("EC130", "RA-00000"), true);
});
