import test from "node:test";
import assert from "node:assert/strict";
import { resolveFragmentInterval } from "../../src/modules/local/voiceConfig.ts";

test("fragment interval defaults to 0.08", () => {
  assert.equal(resolveFragmentInterval(undefined, ""), 0.08);
  assert.equal(resolveFragmentInterval(0.25, ""), 0.25);
  assert.equal(resolveFragmentInterval(0.25, "0.08"), 0.08);
  assert.equal(resolveFragmentInterval(0.25, "bad"), 0.08);
});
