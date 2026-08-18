import crypto from "crypto";

export function createProjectDeleteCredential() {
  const token = crypto.randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashProjectDeleteToken(token),
  };
}

export function hashProjectDeleteToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function verifyProjectDeleteToken(token: string, expectedHash?: string) {
  if (!token || !expectedHash) {
    return false;
  }

  const actual = Buffer.from(hashProjectDeleteToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");

  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
