import { existsSync, readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

function loadEnvironment() {
  for (const path of ['.env', '.env.infrastructure']) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
      }
    }
  }
}

async function main() {
  loadEnvironment();
  const prisma = new PrismaClient();
  try {
    const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT tablename AS table_name FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const migrationTable = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS exists`,
    );
    const migrations = migrationTable[0]?.exists
      ? await prisma.$queryRawUnsafe<Array<{ version: string }>>(
          `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version`,
        )
      : [];
    const authUsers = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*) AS count FROM auth.users`,
    );
    const buckets = await prisma.$queryRawUnsafe<Array<{ id: string; public: boolean }>>(
      `SELECT id, public FROM storage.buckets ORDER BY id`,
    );
    const storageObjects = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*) AS count FROM storage.objects`,
    );
    const rls = await prisma.$queryRawUnsafe<
      Array<{ table_name: string; rls_enabled: boolean; rls_forced: boolean }>
    >(
      `SELECT relname AS table_name, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
       FROM pg_class JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
       WHERE pg_namespace.nspname = 'public' AND pg_class.relkind = 'r' ORDER BY relname`,
    );
    const policies = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*) AS count FROM pg_policies WHERE schemaname IN ('public', 'storage')`,
    );
    const legacyHashes = tables.some((table) => table.table_name === 'users')
      ? await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT count(*) AS count FROM public.users WHERE password_hash IS NOT NULL`,
        )
      : [];
    process.stdout.write(
      JSON.stringify(
        {
          publicTables: tables.map((table) => table.table_name),
          migrationVersions: migrations.map((migration) => migration.version),
          authUserCount: Number(authUsers[0]?.count ?? 0),
          buckets,
          storageObjectCount: Number(storageObjects[0]?.count ?? 0),
          rlsTables: rls.filter((table) => table.rls_enabled).length,
          forcedRlsTables: rls.filter((table) => table.rls_forced).length,
          tablesWithoutRls: rls
            .filter((table) => !table.rls_enabled)
            .map((table) => table.table_name),
          policyCount: Number(policies[0]?.count ?? 0),
          legacyPasswordHashCount: Number(legacyHashes[0]?.count ?? 0),
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
