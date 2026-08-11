import { describe, expect, it } from 'vitest';
import { parseApiEnvironment } from './environment';

const base = {
  NODE_ENV: 'development',
  API_PORT: '3001',
  DATABASE_URL:
    'postgresql://postgres.projectref123:password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require',
  CORS_ORIGINS: 'http://localhost:3000',
  SUPABASE_ENVIRONMENT: 'development',
  SUPABASE_PROJECT_REF: 'projectref123',
  CONFIRM_SUPABASE_PROJECT_REF: 'projectref123',
  SUPABASE_LOCAL: 'false',
  SUPABASE_URL: 'https://projectref123.supabase.co',
  SUPABASE_ANON_KEY: 'development-anon-key-placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'development-service-role-placeholder',
  STORAGE_BUCKET: 'legal-documents',
};

describe('Supabase environment boundary', () => {
  it('accepts a coherent Supabase project configuration', () => {
    expect(parseApiEnvironment(base).SUPABASE_PROJECT_REF).toBe('projectref123');
  });

  it('rejects a database from a different project', () => {
    expect(() =>
      parseApiEnvironment({
        ...base,
        DATABASE_URL:
          'postgresql://postgres.otherproject:password@aws-0-region.pooler.supabase.com:6543/postgres',
      }),
    ).toThrow();
  });

  it('rejects an unconfirmed project ref', () => {
    expect(() =>
      parseApiEnvironment({ ...base, CONFIRM_SUPABASE_PROJECT_REF: 'otherproject' }),
    ).toThrow();
  });

  it('allows only an explicit non-production local Supabase stack', () => {
    const parsed = parseApiEnvironment({
      ...base,
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_LOCAL: 'true',
      SUPABASE_ENVIRONMENT: 'test',
    });
    expect(parsed.SUPABASE_LOCAL).toBe(true);
  });

  it('parses explicit false boolean values without enabling proxy trust', () => {
    const parsed = parseApiEnvironment({ ...base, TRUST_PROXY: 'false', SMTP_SECURE: 'false' });
    expect(parsed.TRUST_PROXY).toBe(false);
    expect(parsed.SMTP_SECURE).toBe(false);
  });

  it('accepts the conventional provider PORT when API_PORT is absent', () => {
    const withoutApiPort = Object.fromEntries(
      Object.entries(base).filter(([key]) => key !== 'API_PORT'),
    );
    expect(parseApiEnvironment({ ...withoutApiPort, PORT: '8080' }).API_PORT).toBe(8080);
  });

  it('requires HTTPS origins, redirect and a confirmed project in production runtime', () => {
    expect(() =>
      parseApiEnvironment({
        ...base,
        NODE_ENV: 'production',
        SUPABASE_ENVIRONMENT: 'production',
      }),
    ).toThrow();

    expect(
      parseApiEnvironment({
        ...base,
        NODE_ENV: 'production',
        SUPABASE_ENVIRONMENT: 'staging',
        CORS_ORIGINS: 'https://app.example.com',
        SUPABASE_AUTH_REDIRECT_URL: 'https://app.example.com/auth/confirm',
      }).SUPABASE_ENVIRONMENT,
    ).toBe('staging');
  });
});
