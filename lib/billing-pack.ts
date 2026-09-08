// Server-authoritative launch pack. Amount is in Kenyan cents, not dollars.
export const LAUNCH_PACK = {
  id: "five-attempts-kes-675-v1",
  attempts: 5,
  amount: 67500,
  currency: "KES",
  approximateUsd: 5,
  durationSeconds: 5,
  resolution: "480p",
  audio: true,
} as const;

export function launchPackPrice() {
  return `${LAUNCH_PACK.currency} ${LAUNCH_PACK.amount / 100}`;
}
