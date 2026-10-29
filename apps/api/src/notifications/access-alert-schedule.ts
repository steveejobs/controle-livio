export function dueAccessAlertTime(
  now: Date,
  after: Date,
  timeZone: string,
  times: readonly string[],
): string | undefined {
  if (!Number.isFinite(after.getTime()) || after >= now || !times.length) return undefined;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  // Scan only minutes after the cursor. Normal runs examine one minute; recovery is capped at a day.
  const lowerBound = Math.max(after.getTime(), now.getTime() - 86_400_000);
  for (
    let instant = Math.floor(now.getTime() / 60_000) * 60_000;
    instant > lowerBound;
    instant -= 60_000
  ) {
    const time = formatter.format(new Date(instant));
    if (times.includes(time)) return time;
  }
  return undefined;
}
