export function definitionAge(header, now = Date.now()) {
  const fields = header.subarray(0, 512).toString('ascii').split(':');
  const seconds = Number(fields[8]);
  const age = now - seconds * 1000;
  if (
    fields[0] !== 'ClamAV-VDB' ||
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    age < -300_000 ||
    age > 48 * 3600_000
  )
    throw new Error('Scanner definitions are unavailable or stale');
  return age;
}
