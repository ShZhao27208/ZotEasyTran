import test from "node:test";
import assert from "node:assert/strict";
import {
  expandMaterialsAbbreviations,
  lookupMaterialsTerm,
} from "../../src/modules/local/materialsTerms.ts";

test("materials term lookup covers words and phrases", () => {
  assert.equal(lookupMaterialsTerm("polymer"), "聚合物");
  assert.equal(lookupMaterialsTerm("yield strength"), "屈服强度");
  assert.equal(lookupMaterialsTerm("coordination number"), "配位数");
  assert.equal(lookupMaterialsTerm("DSC"), "差示扫描量热法");
  assert.equal(lookupMaterialsTerm("grain boundary"), "晶界");
});

test("materials abbreviations expand in sentences", () => {
  assert.equal(
    expandMaterialsAbbreviations("DSC and TGA were measured."),
    "差示扫描量热法 and 热重分析 were measured.",
  );
});
