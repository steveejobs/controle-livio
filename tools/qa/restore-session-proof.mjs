import assert from 'node:assert/strict';

export function roleSessionProbeSql(role) {
  assert.ok(['supabase_admin', 'postgres', 'anon', 'authenticated', 'service_role'].includes(role));
  const observation = (stage) => `SELECT json_build_object('stage','${stage}',
    'sessionUser',session_user,'currentUser',current_user,
    'roleSetting',current_setting('role'),'searchPath',current_setting('search_path'))::text;`;
  return `${observation('before')} SET ROLE "${role}"; ${observation('during')}
    RESET ROLE; ${observation('after')}`;
}

export function assertRoleSessionProof(output, { role, executor, searchPath }) {
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  // Tags are informational. JSON observations, not tag presence, prove state.
  const rows = lines
    .filter((line) => !['SET', 'RESET'].includes(line))
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    rows.map((r) => r.stage),
    ['before', 'during', 'after'],
  );
  for (const [index, row] of rows.entries()) {
    assert.deepEqual(
      Object.keys(row).sort(),
      ['stage', 'sessionUser', 'currentUser', 'roleSetting', 'searchPath'].sort(),
    );
    assert.equal(row.sessionUser, executor, 'Session executor changed');
    assert.equal(row.currentUser, index === 1 ? role : executor, 'Effective session role differs');
    assert.equal(row.roleSetting, index === 1 ? role : 'none', 'SET/RESET role setting differs');
    assert.equal(row.searchPath, searchPath, 'Session search_path differs');
  }
  return { role, canAssumeSessionRole: true, resetVerified: true, observations: rows };
}
