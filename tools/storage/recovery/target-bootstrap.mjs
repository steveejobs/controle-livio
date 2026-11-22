import assert from 'node:assert/strict';

export const recoverySeedPath = './recovery-bootstrap.sql';
export const recoverySeedSql =
  '-- Initialize CLI seed metadata without application fixtures.\nSELECT 1;\n';

// Let the same CLI create seed_files, its primary key and ownership on both
// stacks. Disabling seeds omits that catalog entirely. Never copy the source
// business seed into the restore destination: archived data is replayed later.
export function recoveryTargetConfig(source, project) {
  assert.match(project, /^livio-recovery-\d+-[a-f0-9]{8}$/);
  const projectSetting = /^project_id[ \t]*=.*$/m;
  const seedSection = /^\[db\.seed\][ \t]*\r?\n[\s\S]*?(?=^\[|(?![\s\S]))/m;
  assert.ok(projectSetting.test(source), 'Missing Supabase project identity');
  assert.ok(seedSection.test(source), 'Missing explicit Supabase seed configuration');
  assert.equal((source.match(/^\[db\.seed\]/gm) ?? []).length, 1, 'Ambiguous seed configuration');
  return source
    .replace(projectSetting, `project_id = "${project}"`)
    .replace(seedSection, `[db.seed]\nenabled = true\nsql_paths = ["${recoverySeedPath}"]\n\n`);
}
