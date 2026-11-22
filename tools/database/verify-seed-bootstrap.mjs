import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { recoveryTargetConfig, recoverySeedSql } from '../storage/recovery/target-bootstrap.mjs';

async function metadata(client) {
  return {
    relations: (
      await client.query(
        `SELECT c.relname, c.relkind::text, pg_get_userbyid(c.relowner) AS owner, coalesce(c.relacl::text,'') AS acl, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='supabase_migrations' AND c.relname IN ('seed_files','seed_files_pkey') ORDER BY c.relname`,
      )
    ).rows,
    columns: (
      await client.query(
        `SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull, coalesce(a.attacl::text,'') AS acl FROM pg_attribute a WHERE a.attrelid=to_regclass('supabase_migrations.seed_files') AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,
      )
    ).rows,
    constraints: (
      await client.query(
        `SELECT conname, contype::text, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=to_regclass('supabase_migrations.seed_files') ORDER BY conname`,
      )
    ).rows,
  };
}

export async function verifySeedBootstrap({ root, privateRoot, connectionString }) {
  const url = new URL(connectionString);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/postgres');
  const require = createRequire(resolve(root, 'packages/db/package.json'));
  const { Client } = require('pg');
  const source = new Client({
    host: '127.0.0.1',
    port: Number(url.port),
    database: 'postgres',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: false,
    connectionTimeoutMillis: 3000,
  });
  const name = 'seed_proof_' + randomBytes(8).toString('hex');
  const target = new Client({
    host: '127.0.0.1',
    port: Number(url.port),
    database: name,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: false,
    connectionTimeoutMillis: 3000,
  });
  const cli = resolve(root, 'node_modules/supabase/dist/supabase.js');
  const config = readFileSync(resolve(root, 'supabase/config.toml'), 'utf8');
  const cliEnv = Object.fromEntries(
    [
      'PATH',
      'SystemRoot',
      'WINDIR',
      'ComSpec',
      'USERPROFILE',
      'APPDATA',
      'LOCALAPPDATA',
      'TEMP',
      'TMP',
    ]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  cliEnv.PGPASSWORD = decodeURIComponent(url.password);
  cliEnv.CI = 'true';
  cliEnv.DO_NOT_TRACK = '1';
  const runCli = (directory, database, enabled) => {
    const work = join(privateRoot, directory);
    mkdirSync(join(work, 'supabase/migrations'), { recursive: true });
    const targetConfig = recoveryTargetConfig(config, 'livio-recovery-12345-abcdef12');
    writeFileSync(
      join(work, 'supabase/config.toml'),
      enabled
        ? targetConfig
        : targetConfig.replace('enabled = true\nsql_paths', 'enabled = false\nsql_paths'),
    );
    writeFileSync(join(work, 'supabase/recovery-bootstrap.sql'), recoverySeedSql);
    const address = new URL(url);
    address.password = '';
    address.pathname = '/' + database;
    address.search = '';
    // This identity-checked disposable server listens only on loopback.
    address.searchParams.set('sslmode', 'disable');
    const outcome = spawnSync(
      process.execPath,
      [cli, '--yes', '--workdir', work, 'db', 'push', '--db-url', address.href, '--include-seed'],
      {
        cwd: work,
        env: cliEnv,
        windowsHide: true,
        encoding: 'utf8',
        timeout: 90_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    writeFileSync(
      join(work, 'cli.log'),
      String(outcome.stdout ?? '') + String(outcome.stderr ?? ''),
      { mode: 0o600 },
    );
    assert.equal(
      outcome.status,
      0,
      'Supabase seed metadata command failed; private CLI diagnostic retained',
    );
  };
  try {
    await source.connect();
    const identity = (
      await source.query(
        `SELECT current_setting('data_directory') AS directory, current_setting('listen_addresses') AS listen`,
      )
    ).rows[0];
    assert.equal(resolve(identity.directory), resolve(privateRoot, 'data'));
    assert.equal(identity.listen, '127.0.0.1');
    await source.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    await target.connect();
    runCli('seed-source', 'postgres', true);
    const expected = await metadata(source);
    assert.equal(expected.relations.length, 2);
    assert.deepEqual(
      expected.columns.map((column) => column.attname),
      ['path', 'hash'],
    );
    runCli('seed-target-disabled', name, false);
    assert.equal(
      (await metadata(target)).relations.length,
      0,
      'Old disabled-seed failure was not reproduced',
    );
    runCli('seed-target-fixed', name, true);
    assert.deepEqual(await metadata(target), expected, 'Seed table/PK/owner/ACL drift remains');
    return {
      case: 'supabase-cli-seed-metadata-red-green',
      result: 'PASS',
      scope: 'real CLI and PostgreSQL metadata; not full REC-X18 restore',
    };
  } finally {
    await Promise.allSettled([source.end(), target.end()]);
  }
}
