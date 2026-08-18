export function formatTimestamp(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** Compact cluster-operator age: 34d, 6h, 12m, 45s. */
export function formatAge(value: string, now = Date.now()): string {
  if (!value) return "—";
  const created = new Date(value).getTime();
  if (Number.isNaN(created)) return value;

  const seconds = Math.max(0, Math.round((now - created) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days}d`;
  return `${Math.floor(days / 365)}y`;
}
