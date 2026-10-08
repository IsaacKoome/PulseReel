// Move a conventional MP4's moov index ahead of its media data so playback can
// start with a forward HTTP read. This is a lossless container rewrite: encoded
// video and audio samples are not changed.
type Box = { start: number; end: number; headerSize: number; type: string };

function boxes(bytes: Buffer, start: number, end: number): Box[] | null {
  const result: Box[] = [];
  let position = start;
  while (position < end) {
    if (end - position < 8) return null;
    const size32 = bytes.readUInt32BE(position);
    const type = bytes.toString("ascii", position + 4, position + 8);
    const headerSize = size32 === 1 ? 16 : 8;
    if (end - position < headerSize) return null;
    const size = size32 === 0
      ? end - position
      : size32 === 1
        ? Number(bytes.readBigUInt64BE(position + 8))
        : size32;
    if (!Number.isSafeInteger(size) || size < headerSize || size > end - position) return null;
    result.push({ start: position, end: position + size, headerSize, type });
    position += size;
  }
  return result;
}

const OFFSET_CONTAINERS = new Set(["trak", "mdia", "minf", "stbl"]);

function adjustChunkOffsets(moov: Buffer, shift: number, mediaStart: number, mediaEnd: number): boolean {
  let adjusted = 0;

  function visit(start: number, end: number): boolean {
    const children = boxes(moov, start, end);
    if (!children) return false;

    for (const child of children) {
      if (OFFSET_CONTAINERS.has(child.type)) {
        if (!visit(child.start + child.headerSize, child.end)) return false;
        continue;
      }
      if (child.type !== "stco" && child.type !== "co64") continue;

      const dataStart = child.start + child.headerSize;
      if (child.end - dataStart < 8) return false;
      const count = moov.readUInt32BE(dataStart + 4);
      const width = child.type === "stco" ? 4 : 8;
      if (count > Math.floor((child.end - dataStart - 8) / width)) return false;
      for (let index = 0; index < count; index += 1) {
        const position = dataStart + 8 + index * width;
        const offset = width === 4
          ? BigInt(moov.readUInt32BE(position))
          : moov.readBigUInt64BE(position);
        if (offset < BigInt(mediaStart) || offset >= BigInt(mediaEnd)) return false;
        const shifted = offset + BigInt(shift);
        if (width === 4) {
          if (shifted > BigInt(0xffff_ffff)) return false;
          moov.writeUInt32BE(Number(shifted), position);
        } else {
          moov.writeBigUInt64BE(shifted, position);
        }
        adjusted += 1;
      }
    }
    return true;
  }

  return visit(8, moov.length) && adjusted > 0;
}

export function makeMp4Streamable(input: Uint8Array): Uint8Array {
  const bytes = Buffer.from(input);
  const top = boxes(bytes, 0, bytes.length);
  if (!top || top[0]?.type !== "ftyp") return input;

  const movieIndex = top.find((box) => box.type === "moov");
  const media = top.filter((box) => box.type === "mdat");
  if (!movieIndex || media.length !== 1 || top.at(-1) !== movieIndex) return input;
  if (movieIndex.start < media[0].start) return input;

  const moov = Buffer.from(bytes.subarray(movieIndex.start, movieIndex.end));
  if (moov.readUInt32BE(0) !== moov.length) return input;
  const mediaStart = media[0].start + media[0].headerSize;
  if (!adjustChunkOffsets(moov, moov.length, mediaStart, media[0].end)) return input;

  return Buffer.concat([
    bytes.subarray(0, top[0].end),
    moov,
    bytes.subarray(top[0].end, movieIndex.start),
  ]);
}
