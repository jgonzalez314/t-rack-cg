import { describe, expect, it } from "vitest";
import { parseSettings } from "./settings";

describe("parseSettings", () => {
  it("defaults to entering the sell price by hand", () => {
    expect(parseSettings(null)).toEqual({ sellPriceSource: "manual" });
    expect(parseSettings("not json")).toEqual({ sellPriceSource: "manual" });
    expect(parseSettings('{"sellPriceSource":"other"}')).toEqual({ sellPriceSource: "manual" });
  });

  it("reads the TCGplayer choice", () => {
    expect(parseSettings('{"sellPriceSource":"tcgplayer"}')).toEqual({ sellPriceSource: "tcgplayer" });
  });
});
