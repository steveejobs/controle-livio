import type { NextConfig } from 'next';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const publicEnvironmentNames = new Set([
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
if (!publicSupabaseUrl || !publicSupabaseAnonKey) {
  throw new Error('Configuração pública do Supabase ausente');
}

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@livio/ui', '@livio/shared'],
  experimental: { optimizePackageImports: ['@livio/ui'] },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: publicSupabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: publicSupabaseAnonKey,
  },
};

export default nextConfig;
