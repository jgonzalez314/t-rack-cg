// Test helper: reads the stored zips that buildXlsx writes.
import { expect } from "vitest";
import { crc32 } from "./xlsx";

/** Reads a stored (uncompressed) zip into name -> text. */
export function unzip(bytes: Uint8Array): Record<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  let end = bytes.length - 22;
  while (view.getUint32(end, true) !== 0x06054b50) end--;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    const localNameLen = view.getUint16(offset + 26, true);
    const start = offset + 30 + localNameLen;
    const data = bytes.subarray(start, start + size);
    expect(crc32(data)).toBe(view.getUint32(at + 16, true));
    out[name] = dec.decode(data);
    at += 46 + nameLen;
  }
  return out;
}
