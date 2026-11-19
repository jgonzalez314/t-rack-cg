// A small .xlsx writer that runs in the browser, so exporting works offline
// and adds no dependency. It covers what the export needs: several sheets,
// styled cells (bold, fills, borders, number formats), formulas with saved
// results, column widths, a frozen header row and filters.
//
// An .xlsx file is a zip of XML files (Office Open XML, ECMA-376). The zip is
// written uncompressed ("stored"), which every spreadsheet app reads.

export interface CellStyle {
  bold?: boolean;
  /** Font color, like "FFFFFF". */
  color?: string;
  /** Background color, like "1F4E78". */
  fill?: string;
  /** Excel number format, like "$#,##0.00" or "0%". */
  numFmt?: string;
  align?: "left" | "center" | "right";
  wrap?: boolean;
  borderTop?: boolean;
  borderBottom?: boolean;
}

export type CellValue = string | number | boolean | Date | null | undefined;

export interface Cell {
  value?: CellValue;
  /** A formula without the "=", like "SUM(B2:B9)". `value` is its saved result. */
  formula?: string;
  style?: CellStyle;
}

export type Row = (Cell | CellValue)[];

export interface Sheet {
  name: string;
  rows: Row[];
  /** Column widths in characters. Missing widths are worked out from the content. */
  widths?: number[];
  /** Number of top rows that stay in view when scrolling. */
  freezeRows?: number;
  /** Adds filter buttons to the first row, over this many rows (header included). */
  filterRows?: number;
}

const enc = new TextEncoder();

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Characters XML 1.0 does not allow.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnName(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Excel's day number for a date (days since 1899-12-30), using its calendar date. */
export function excelDate(d: Date): number {
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000;
}

/** Excel's day number for "YYYY-MM-DD". */
export function excelDateFromIso(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}

/** Sheet names: at most 31 characters, none of []:*?/\ and unique. */
export function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base = (raw.replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim() || "Sheet").slice(0, 31);
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) {
      const suffix = ` (${i})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

// ---- styles -----------------------------------------------------------------

class Styles {
  private numFmts = new Map<string, number>();
  private fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
  private fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  private borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
  private xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private ids = new Map<string, number>();

  private static BUILTIN: Record<string, number> = {
    General: 0,
    "0": 1,
    "0.00": 2,
    "#,##0": 3,
    "#,##0.00": 4,
    "0%": 9,
    "0.00%": 10,
  };

  private indexOf(list: string[], xml: string): number {
    const i = list.indexOf(xml);
    if (i >= 0) return i;
    list.push(xml);
    return list.length - 1;
  }

  id(style?: CellStyle): number {
    if (!style) return 0;
    const key = JSON.stringify(style);
    const known = this.ids.get(key);
    if (known !== undefined) return known;

    let numFmtId = 0;
    if (style.numFmt) {
      numFmtId = Styles.BUILTIN[style.numFmt] ?? this.numFmts.get(style.numFmt) ?? 164 + this.numFmts.size;
      if (!(style.numFmt in Styles.BUILTIN)) this.numFmts.set(style.numFmt, numFmtId);
    }
    const fontId = this.indexOf(
      this.fonts,
      `<font>${style.bold ? "<b/>" : ""}<sz val="11"/>${style.color ? `<color rgb="FF${style.color}"/>` : ""}<name val="Calibri"/><family val="2"/></font>`,
    );
    const fillId = style.fill
      ? this.indexOf(
          this.fills,
          `<fill><patternFill patternType="solid"><fgColor rgb="FF${style.fill}"/><bgColor indexed="64"/></patternFill></fill>`,
        )
      : 0;
    const line = '<color rgb="FF8EA9C1"/>';
    const borderId =
      style.borderTop || style.borderBottom
        ? this.indexOf(
            this.borders,
            `<border><left/><right/>${style.borderTop ? `<top style="thin">${line}</top>` : "<top/>"}${
              style.borderBottom ? `<bottom style="medium">${line}</bottom>` : "<bottom/>"
            }<diagonal/></border>`,
          )
        : 0;
    const align =
      style.align || style.wrap
        ? `<alignment${style.align ? ` horizontal="${style.align}"` : ""} vertical="center"${style.wrap ? ' wrapText="1"' : ""}/>`
        : "";
    const attrs = [
      `numFmtId="${numFmtId}"`,
      `fontId="${fontId}"`,
      `fillId="${fillId}"`,
      `borderId="${borderId}"`,
      'xfId="0"',
      numFmtId ? 'applyNumberFormat="1"' : "",
      fontId ? 'applyFont="1"' : "",
      fillId ? 'applyFill="1"' : "",
      borderId ? 'applyBorder="1"' : "",
      align ? 'applyAlignment="1"' : "",
    ].filter(Boolean);
    this.xfs.push(align ? `<xf ${attrs.join(" ")}>${align}</xf>` : `<xf ${attrs.join(" ")}/>`);
    const id = this.xfs.length - 1;
    this.ids.set(key, id);
    return id;
  }

  xml(): string {
    const numFmts = [...this.numFmts]
      .map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`)
      .join("");
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (this.numFmts.size ? `<numFmts count="${this.numFmts.size}">${numFmts}</numFmts>` : "") +
      `<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join("")}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join("")}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      "</styleSheet>"
    );
  }
}

// ---- sheets -----------------------------------------------------------------

function toCell(c: Cell | CellValue): Cell {
  return c !== null && typeof c === "object" && !(c instanceof Date) ? c : { value: c };
}

/** Rough display width of a cell, in characters. */
function displayWidth(cell: Cell): number {
  const v = cell.value;
  if (v === null || v === undefined || v === "") return 0;
  if (v instanceof Date) return 10;
  if (typeof v === "number") {
    const fmt = cell.style?.numFmt ?? "";
    if (fmt.includes("yy")) return 10;
    if (fmt.includes("%")) return 7;
    const text = Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
    return text.length + (fmt.includes("$") ? 4 : 1);
  }
  return String(v)
    .split("\n")
    .reduce((m, line) => Math.max(m, line.length), 0);
}

function sheetXml(sheet: Sheet, styles: Styles, strings: SharedStrings): string {
  const cells = sheet.rows.map((r) => r.map(toCell));
  const columns = cells.reduce((m, r) => Math.max(m, r.length), 0);

  const widths = Array.from({ length: columns }, (_, i) => {
    const given = sheet.widths?.[i];
    if (given) return given;
    const longest = cells.reduce((m, r) => Math.max(m, r[i] ? displayWidth(r[i]) * (r[i].style?.bold ? 1.1 : 1) : 0), 0);
    return Math.min(45, Math.max(8, Math.ceil(longest) + 2));
  });
  const cols = widths.length
    ? `<cols>${widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(2)}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";

  const rowsXml = cells
    .map((row, r) => {
      const ref = r + 1;
      const cellsXml = row
        .map((cell, c) => {
          const at = `${columnName(c)}${ref}`;
          const s = styles.id(cell.style);
          const sAttr = s ? ` s="${s}"` : "";
          const f = cell.formula ? `<f>${escapeXml(cell.formula)}</f>` : "";
          const v = cell.value;
          if (v === null || v === undefined || v === "") {
            if (f) return `<c r="${at}"${sAttr}>${f}</c>`;
            return s ? `<c r="${at}"${sAttr}/>` : "";
          }
          if (typeof v === "number") {
            if (!Number.isFinite(v)) return s ? `<c r="${at}"${sAttr}/>` : "";
            return `<c r="${at}"${sAttr}>${f}<v>${v}</v></c>`;
          }
          if (v instanceof Date) return `<c r="${at}"${sAttr}>${f}<v>${excelDate(v)}</v></c>`;
          if (typeof v === "boolean") return `<c r="${at}"${sAttr} t="b">${f}<v>${v ? 1 : 0}</v></c>`;
          if (f) return `<c r="${at}"${sAttr} t="str">${f}<v>${escapeXml(v)}</v></c>`;
          return `<c r="${at}"${sAttr} t="s"><v>${strings.id(v)}</v></c>`;
        })
        .join("");
      return `<row r="${ref}">${cellsXml}</row>`;
    })
    .join("");

  const freeze = sheet.freezeRows ?? 0;
  const view = freeze
    ? `<sheetView workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${freeze + 1}" sqref="A${freeze + 1}"/></sheetView>`
    : '<sheetView workbookViewId="0"/>';
  const lastCol = columnName(Math.max(0, columns - 1));
  const filter =
    sheet.filterRows && columns ? `<autoFilter ref="A1:${lastCol}${Math.max(1, sheet.filterRows)}"/>` : "";
  const dimension = cells.length && columns ? `A1:${lastCol}${cells.length}` : "A1";

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
    `<dimension ref="${dimension}"/>` +
    `<sheetViews>${view}</sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    cols +
    `<sheetData>${rowsXml}</sheetData>` +
    filter +
    '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
    "</worksheet>"
  );
}

class SharedStrings {
  private list: string[] = [];
  private map = new Map<string, number>();
  count = 0;

  id(s: string): number {
    this.count++;
    let i = this.map.get(s);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(s);
      this.map.set(s, i);
    }
    return i;
  }

  xml(): string {
    const items = this.list
      .map((s) => `<si><t${/^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : ""}>${escapeXml(s)}</t></si>`)
      .join("");
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.count}" uniqueCount="${this.list.length}">${items}</sst>`
    );
  }
}

// ---- workbook ---------------------------------------------------------------

/** Builds the .xlsx file's bytes. */
export function buildXlsx(sheets: Sheet[], options: { title?: string; created?: Date } = {}): Uint8Array {
  if (!sheets.length) throw new Error("A workbook needs at least one sheet");
  const styles = new Styles();
  const strings = new SharedStrings();
  const names = sheetNames(sheets.map((s) => s.name));
  const sheetFiles = sheets.map((s) => sheetXml(s, styles, strings));
  const created = (options.created ?? new Date()).toISOString().replace(/\.\d+Z$/, "Z");
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  const filterNames = sheets
    .map((s, i) => {
      if (!s.filterRows) return "";
      const columns = s.rows.reduce((m, r) => Math.max(m, r.length), 0);
      const quoted = `'${names[i].replace(/'/g, "''")}'`;
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${escapeXml(
        `${quoted}!$A$1:$${columnName(Math.max(0, columns - 1))}$${Math.max(1, s.filterRows)}`,
      )}</definedName>`;
    })
    .join("");

  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      xml +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheets
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join("") +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
        "</Types>",
    ],
    [
      "_rels/.rels",
      xml +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
        "</Relationships>",
    ],
    [
      "docProps/core.xml",
      xml +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        (options.title ? `<dc:title>${escapeXml(options.title)}</dc:title>` : "") +
        "<dc:creator>T-rack-CG</dc:creator>" +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>` +
        `<dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>` +
        "</cp:coreProperties>",
    ],
    [
      "docProps/app.xml",
      xml +
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>T-rack-CG</Application></Properties>',
    ],
    [
      "xl/workbook.xml",
      xml +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<bookViews><workbookView activeTab="0"/></bookViews>' +
        `<sheets>${names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
        (filterNames ? `<definedNames>${filterNames}</definedNames>` : "") +
        '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
        "</workbook>",
    ],
    [
      "xl/_rels/workbook.xml.rels",
      xml +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
        "</Relationships>",
    ],
    ...sheetFiles.map((x, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, x]),
    ["xl/styles.xml", styles.xml()],
    ["xl/sharedStrings.xml", strings.xml()],
  ];

  return zip(files.map(([name, text]) => ({ name, data: enc.encode(text) })), options.created ?? new Date());
}

// ---- zip --------------------------------------------------------------------

let crcTable: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip archive with the files stored uncompressed. */
export function zip(files: { name: string; data: Uint8Array }[], when: Date = new Date()): Uint8Array {
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = (Math.max(0, when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // names are UTF-8
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    locals.push(local, f.data);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length + size;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
