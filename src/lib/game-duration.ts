type DateValue = Date | string | number;

const toTimestamp = (value: DateValue) =>
  value instanceof Date ? value.getTime() : new Date(value).getTime();

export function formatGameDuration(startedAt: DateValue, endedAt: DateValue | null | undefined) {
  if (endedAt === null || endedAt === undefined) return null;

  const startedAtMs = toTimestamp(startedAt);
  const endedAtMs = toTimestamp(endedAt);
  const durationMs = endedAtMs - startedAtMs;
  if (
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(endedAtMs) ||
    durationMs < 0 ||
    durationMs > 5 * 60 * 60 * 1_000
  ) {
    return null;
  }

  const totalMinutes = Math.floor(durationMs / 60_000);
  if (totalMinutes < 1) return '<1m';

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
