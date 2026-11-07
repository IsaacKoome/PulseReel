export function feedWindow<T extends { id: string }>(items: T[], limit: number, anchor?: string | null) {
  const index = anchor ? items.findIndex((item) => item.id === anchor) : -1;
  const start = index >= limit ? Math.max(0, index - 1) : 0;
  return items.slice(start, start + limit);
}
