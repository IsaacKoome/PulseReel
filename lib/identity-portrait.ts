import sharp from "sharp";

/** Fill Seedance's portrait starting frame without introducing blurred letterbox bands. */
export async function portraitIdentityBuffer(file: File) {
  const input = Buffer.from(await file.arrayBuffer());
  const portrait = await sharp(input)
    .rotate()
    .resize(480, 832, { fit: "cover", position: sharp.strategy.attention })
    .jpeg({ quality: 84 })
    .toBuffer();
  if (portrait.byteLength <= 240_000) return portrait;
  return sharp(portrait).jpeg({ quality: 70 }).toBuffer();
}
