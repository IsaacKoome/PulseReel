import assert from "node:assert/strict";
import test from "node:test";
import { makeMp4Streamable } from "../lib/mp4-faststart.ts";

function box(type: string, payload: Buffer) {
  const result = Buffer.alloc(8 + payload.length);
  result.writeUInt32BE(result.length, 0);
  result.write(type, 4, 4, "ascii");
  payload.copy(result, 8);
  return result;
}

function fixture(offsetType: "stco" | "co64" = "stco") {
  const ftyp = box("ftyp", Buffer.from("isom0000", "ascii"));
  const mdat = box("mdat", Buffer.from("movie samples", "ascii"));
  const chunkOffset = ftyp.length + 8;
  const entries = Buffer.alloc(offsetType === "stco" ? 12 : 16);
  entries.writeUInt32BE(1, 4);
  if (offsetType === "stco") entries.writeUInt32BE(chunkOffset, 8);
  else entries.writeBigUInt64BE(BigInt(chunkOffset), 8);
  const moov = box("moov", box("trak", box("mdia", box("minf", box("stbl", box(offsetType, entries))))));
  return { ftyp, mdat, moov, original: Buffer.concat([ftyp, mdat, moov]), chunkOffset };
}

for (const offsetType of ["stco", "co64"] as const) {
  test(`MP4 fast-start moves moov before media and patches ${offsetType} without touching samples`, () => {
    const { ftyp, mdat, moov, original, chunkOffset } = fixture(offsetType);
    const result = Buffer.from(makeMp4Streamable(original));
    assert.equal(result.length, original.length);
    assert.equal(result.toString("ascii", ftyp.length + 4, ftyp.length + 8), "moov");
    assert.deepEqual(result.subarray(ftyp.length + moov.length), mdat);

    const offsetPosition = ftyp.length + 8 + 8 * 5 + 8;
    const newOffset = offsetType === "stco"
      ? BigInt(result.readUInt32BE(offsetPosition))
      : result.readBigUInt64BE(offsetPosition);
    assert.equal(newOffset, BigInt(chunkOffset + moov.length));
    assert.equal(result.toString("ascii", Number(newOffset), Number(newOffset) + 13), "movie samples");
  });
}

test("MP4 fast-start leaves already streamable and unknown files unchanged", () => {
  const { ftyp, mdat, moov, original } = fixture();
  const streamable = Buffer.concat([ftyp, moov, mdat]);
  assert.deepEqual(Buffer.from(makeMp4Streamable(streamable)), streamable);
  assert.deepEqual(Buffer.from(makeMp4Streamable(Buffer.from("not a movie"))), Buffer.from("not a movie"));

  const invalid = Buffer.from(original);
  const offsetPosition = ftyp.length + mdat.length + 8 + 8 * 5 + 8;
  invalid.writeUInt32BE(1, offsetPosition);
  assert.deepEqual(Buffer.from(makeMp4Streamable(invalid)), invalid);
});
