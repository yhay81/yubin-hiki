import { describe, expect, it } from "vitest";

import {
  formatPostalCode,
  normalizePostalCode,
  normalizeSearch,
  normalizeText,
  postalCodePattern,
  toKatakana,
} from "../src/domain/postal";

describe("postal normalization", () => {
  it("accepts common full-width and hyphenated postal input", () => {
    expect(normalizePostalCode("〒１００－０００１")).toBe("1000001");
    expect(formatPostalCode("1000001")).toBe("100-0001");
    expect(postalCodePattern.test("1000001")).toBe(true);
    expect(postalCodePattern.test("100-0001")).toBe(false);
  });

  it("normalizes hiragana to source-data katakana", () => {
    expect(toKatakana("とうきょうトウキョウ")).toBe("トウキョウトウキョウ");
    expect(normalizeText("　なはし　くもじ　")).toBe("ナハシ クモジ");
  });

  it("distinguishes number and address searches", () => {
    expect(normalizeSearch({ q: "〒１００－０００１" })).toEqual({
      kind: "postal",
      prefecture: "",
      query: "1000001",
      tokens: ["1000001"],
    });
    expect(normalizeSearch({ q: "100-00" })).toEqual({
      kind: "postal",
      prefecture: "",
      query: "10000",
      tokens: ["10000"],
    });
    expect(normalizeSearch({ q: "千代田区 千代田", prefecture: "東京都" })).toEqual({
      kind: "address",
      prefecture: "東京都",
      query: "千代田区 千代田",
      tokens: ["千代田区", "千代田"],
    });
  });

  it("drops unknown prefecture values", () => {
    expect(normalizeSearch({ q: "千代田", prefecture: "東京" }).prefecture).toBe("");
  });
});
