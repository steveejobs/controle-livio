import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { recoveryTargetConfig, recoverySeedPath, recoverySeedSql } from './target-bootstrap.mjs';

const project = 'livio-recovery-12345-abcdef12';

test('restore uses a metadata-only seed while preserving Auth, network and DB settings', () => {
  const source = readFileSync(new URL('../../../supabase/config.toml', import.meta.url), 'utf8');
  for (const input of [source, source.replaceAll('\r\n', '\n')]) {
    const config = recoveryTargetConfig(input, project);
    assert.match(config, new RegExp(`^project_id = "${project}"`, 'm'));
    assert.match(
      config,
      /\[db\.seed\]\nenabled = true\nsql_paths = \["\.\/recovery-bootstrap\.sql"\]/,
    );
    assert.equal(config.includes('"./seed.sql"'), false);
    assert.equal(config.slice(config.indexOf('[studio]')), input.slice(input.indexOf('[studio]')));
    assert.equal(
      config.slice(config.indexOf('[api]'), config.indexOf('[db.seed]')),
      input.slice(input.indexOf('[api]'), input.indexOf('[db.seed]')),
    );
  }
  assert.equal(recoverySeedPath, './recovery-bootstrap.sql');
  assert.equal(
    recoverySeedSql
      .split('\n')
      .filter((line) => line && !line.startsWith('--'))
      .join('\n'),
    'SELECT 1;',
  );
});

test('custom source seeds cannot execute in the independent restore target', () => {
  const source =
    'project_id = "source"\n[db.seed]\nenabled = false\nsql_paths = ["./private.sql", "../external.sql"]\n';
  const config = recoveryTargetConfig(source, project);
  assert.equal(config.includes('private.sql'), false);
  assert.equal(config.includes('external.sql'), false);
  assert.match(config, /enabled = true/);
});

test('ambiguous configuration and foreign project identities stop before startup', () => {
  const source = 'project_id = "source"\n[db.seed]\nenabled = true\n';
  for (const identity of [
    'production',
    'livio-recovery-12345-../../shared',
    'livio-recovery-12345-abcdef12"',
  ]) {
    assert.throws(() => recoveryTargetConfig(source, identity));
  }
  assert.throws(() => recoveryTargetConfig('project_id = "source"\n', project));
  assert.throws(() => recoveryTargetConfig('[db.seed]\nenabled = true\n', project));
  assert.throws(() => recoveryTargetConfig(source + '[db.seed]\nenabled = false\n', project));
});
