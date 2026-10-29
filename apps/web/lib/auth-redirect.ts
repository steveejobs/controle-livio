export function authenticationDestination(next: string | null, origin: string): string | undefined {
  if (!next?.startsWith('/')) return next ? undefined : '/';
  try {
    const destination = new URL(next, origin);
    return destination.origin === new URL(origin).origin
      ? `${destination.pathname}${destination.search}${destination.hash}`
      : undefined;
  } catch {
    return undefined;
  }
}
