import { existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

export function validateIdentityEnvironment(env, root, options = {}) {
  if (
    (options.platform ?? process.platform) !== 'linux' ||
    env.GITHUB_ACTIONS !== 'true' ||
    env.RUNNER_OS !== 'Linux' ||
    env.LIVIO_IDENTITY_INTEGRATION !== 'disposable'
  )
    throw new Error('Identity integration requires an explicit disposable Linux CI runner');
  if (
    env.NODE_ENV !== 'test' ||
    env.SUPABASE_LOCAL !== 'true' ||
    env.SUPABASE_ENVIRONMENT !== 'test'
  )
    throw new Error('Non-test identity environment rejected');
  const exists = options.exists ?? existsSync;
  for (const p of [
    ...[
      '',
      '.env.local',
      '.env.production',
      '.env.production.local',
      '.env.test',
      '.env.development',
      '.env.development.local',
    ].flatMap((suffix) =>
      ['', 'apps/api/', 'apps/web/'].map((prefix) => prefix + (suffix || '.env')),
    ),
    'supabase/.temp/project-ref',
  ])
    if (exists(resolve(root, p))) throw new Error('Shared or linked environment rejected');
  if (
    env.SUPABASE_ACCESS_TOKEN ||
    env.SUPABASE_DB_PASSWORD ||
    Object.keys(env).some((k) => k.startsWith('SMTP_'))
  )
    throw new Error('External management credentials rejected');
  for (const [key, port, protocol] of [
    ['NEXT_PUBLIC_API_URL', '3001', 'http:'],
    ['NEXT_PUBLIC_SUPABASE_URL', '54321', 'http:'],
    ['DATABASE_URL', '54322', 'postgresql:'],
  ]) {
    const u = new URL(env[key]);
    if (
      !['localhost', '127.0.0.1'].includes(u.hostname) ||
      u.port !== port ||
      u.protocol !== protocol
    )
      throw new Error('External endpoint rejected: ' + key);
  }
  if (
    !env.SUPABASE_SERVICE_ROLE_KEY ||
    !env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.CLAMAV_HOST !== '127.0.0.1' ||
    env.CLAMAV_PORT !== '13310'
  )
    throw new Error('Real local Auth/Storage/scanner required');
  if (!env.RUNNER_TEMP || !env.LIVIO_QA_OUTPUT) throw new Error('Runner evidence paths required');
  const local = relative(resolve(env.RUNNER_TEMP), resolve(env.LIVIO_QA_OUTPUT));
  if (local.startsWith('..') || isAbsolute(local))
    throw new Error('External evidence path rejected');
}
