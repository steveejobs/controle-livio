import type { NextConfig } from 'next';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const publicEnvironmentNames = new Set([
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
]);

function readPublicWorkspaceEnvironment() {
  const values: Record<string, string> = {};
  const environmentFiles = ['.env', '.env.production', '.env.local', '.env.production.local'];

  for (const fileName of environmentFiles) {
    const filePath = resolve(workspaceRoot, fileName);
    if (!existsSync(filePath)) continue;

    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      const environmentName = match?.[1];
      const environmentValue = match?.[2];
      if (
        !environmentName ||
        environmentValue === undefined ||
        !publicEnvironmentNames.has(environmentName)
      ) {
        continue;
      }

      const rawValue = environmentValue.trim();
      values[environmentName] =
        (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"))
          ? rawValue.slice(1, -1)
          : rawValue;
    }
  }

  return values;
}

const workspaceEnvironment = readPublicWorkspaceEnvironment();

const publicApiUrl = process.env.NEXT_PUBLIC_API_URL ?? workspaceEnvironment.NEXT_PUBLIC_API_URL;
const publicSupabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  workspaceEnvironment.NEXT_PUBLIC_SUPABASE_URL ??
  workspaceEnvironment.SUPABASE_URL;
const publicSupabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  workspaceEnvironment.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  workspaceEnvironment.SUPABASE_ANON_KEY;
if (!publicApiUrl || !publicSupabaseUrl || !publicSupabaseAnonKey) {
  throw new Error('Configuração pública da API/Supabase ausente');
}

function secureOrigin(value: string, name: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} deve usar HTTP ou HTTPS`);
  }
  return url.origin;
}

const apiOrigin = secureOrigin(publicApiUrl, 'NEXT_PUBLIC_API_URL');
const supabaseOrigin = secureOrigin(publicSupabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL');
const supabaseRealtimeOrigin = supabaseOrigin.replace(/^http/, 'ws');
const developmentDirectives = process.env.NODE_ENV === 'development' ? ' ws: wss:' : '';
const developmentScriptDirective = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '';
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  `connect-src 'self' ${apiOrigin} ${supabaseOrigin} ${supabaseRealtimeOrigin}${developmentDirectives}`,
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${developmentScriptDirective}`,
  "style-src 'self' 'unsafe-inline'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=()' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@livio/ui', '@livio/shared'],
  experimental: { optimizePackageImports: ['@livio/ui'] },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  env: {
    NEXT_PUBLIC_API_URL: publicApiUrl,
    NEXT_PUBLIC_SUPABASE_URL: publicSupabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: publicSupabaseAnonKey,
  },
};

export default nextConfig;
