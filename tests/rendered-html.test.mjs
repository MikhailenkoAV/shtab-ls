import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("GitHub Pages export contains the main application sections", async () => {
  const html = await readFile(new URL("../out/index.html", import.meta.url), "utf8");
  assert.match(html, /Штаб ЛС/);
  assert.match(html, /Полётные смены/);
  assert.match(html, /Личные дела/);
});
