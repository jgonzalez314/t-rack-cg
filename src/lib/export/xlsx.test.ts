import { describe, expect, it } from "vitest";
import { unzip } from "./test-unzip";
import { buildXlsx, columnName, crc32, escapeXml, excelDateFromIso, sheetNames } from "./xlsx";

describe("xlsx helpers", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("names columns like Excel", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });

  it("turns dates into Excel day numbers", () => {
    expect(excelDateFromIso("2026-11-19")).toBe(46345);
    expect(excelDateFromIso("1900-03-01")).toBe(61);
  });

  it("escapes XML and drops characters XML can't hold", () => {
    expect(escapeXml(`a<b>&"c"\u0001`)).toBe("a&lt;b&gt;&amp;&quot;c&quot;");
  });

  it("makes sheet names valid and unique", () => {
    expect(sheetNames(["Cards", "cards", "a/b", "x".repeat(40), ""])).toEqual([
      "Cards",
      "cards (2)",
      "a b",
      "x".repeat(31),
      "Sheet",
    ]);
  });
});

describe("buildXlsx", () => {
  it("writes a workbook with styles, a frozen header and filters", () => {
    const files = unzip(
      buildXlsx([
        {
          name: "Data",
          rows: [
            [{ value: "Price", style: { bold: true, fill: "1F4E78" } }, "Name"],
            [{ value: 1.5, style: { numFmt: "$#,##0.00" } }, "Pikachu & Co"],
            [{ formula: "SUM(A2:A2)", value: 1.5, style: { numFmt: "$#,##0.00" } }],
          ],
          freezeRows: 1,
          filterRows: 2,
        },
      ]),
    );
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml"]),
    );
    const sheet = files["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toContain('<autoFilter ref="A1:B2"/>');
    expect(sheet).toContain("<f>SUM(A2:A2)</f><v>1.5</v>");
    expect(sheet).toMatch(/<col min="1" max="1" width="[\d.]+" customWidth="1"\/>/);
    expect(files["xl/sharedStrings.xml"]).toContain("<t>Pikachu &amp; Co</t>");
    expect(files["xl/styles.xml"]).toContain('formatCode="$#,##0.00"');
    expect(files["xl/styles.xml"]).toContain('<fgColor rgb="FF1F4E78"/>');
    expect(files["xl/workbook.xml"]).toContain('<sheet name="Data" sheetId="1" r:id="rId1"/>');
  });
});
