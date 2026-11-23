export function createCorsOptions(origins: readonly string[]) {
  return {
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Organization-Id',
      'X-Request-Id',
      'Idempotency-Key',
    ],
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      if (!origin || origins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
  };
}
