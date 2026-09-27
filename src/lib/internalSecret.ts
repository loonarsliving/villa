import "server-only";

import { timingSafeEqual } from "node:crypto";

/** Perbandingan waktu-konstan untuk header x-internal-secret antar-server. */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
