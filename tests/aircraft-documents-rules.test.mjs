import assert from "node:assert/strict";
import test from "node:test";
import {
  activeAircraftDocument,
  aircraftDocumentDefinitions,
  aircraftDocumentState,
} from "../app/aircraft-documents-rules.ts";

test("KVP and AON onboard lists stay separate and contain no international documents", () => {
  const kvp = aircraftDocumentDefinitions("КВП", "permanent");
  const aon = aircraftDocumentDefinitions("АОН", "permanent");
  assert.ok(kvp.some((item) => item.id === "mel"));
  assert.ok(!aon.some((item) => item.id === "mel"));
  assert.ok(aon.some((item) => item.id === "owner-authority"));
  assert.ok(![...kvp, ...aon].some((item) => /международ|тамож|генеральн.*декларац/i.test(item.title)));
});

test("only a non-archived document is used for current completeness", () => {
  const records = [
    { id: "old", aircraft: "RA-01697", operation: "КВП", definitionId: "registration", createdAt: "2026-01-01", archivedAt: "2026-08-01" },
    { id: "new", aircraft: "RA-01697", operation: "КВП", definitionId: "registration", createdAt: "2026-08-01", archivedAt: "" },
  ];
  assert.equal(activeAircraftDocument(records, "RA-01697", "КВП", "registration")?.id, "new");
});

test("document expiry becomes a warning for the final 45 days", () => {
  assert.equal(aircraftDocumentState({ expiryDate: "2026-09-20" }, new Date("2026-08-24T12:00:00")), "warning");
  assert.equal(aircraftDocumentState({ expiryDate: "2026-08-20" }, new Date("2026-08-24T12:00:00")), "expired");
  assert.equal(aircraftDocumentState({ expiryDate: "2027-01-01" }, new Date("2026-08-24T12:00:00")), "valid");
});
