import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as prettier from 'prettier';

const tracked = execFileSync('git', ['ls-files', '--cached', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const dirtyContext =
  spawnSync('git', ['diff', '--quiet', '--', 'PROJECT_CONTEXT.md'], { stdio: 'ignore' }).status ===
  1;
const files = dirtyContext ? tracked.filter((file) => file !== 'PROJECT_CONTEXT.md') : tracked;
let checked = 0;
const unformatted = [];

for (const file of files) {
  const info = await prettier.getFileInfo(file, { ignorePath: '.prettierignore' });
  if (info.ignored || !info.inferredParser) continue;
  const config = (await prettier.resolveConfig(file)) ?? {};
  const source = readFileSync(file, 'utf8');
  checked += 1;
  if (!(await prettier.check(source, { ...config, filepath: file }))) unformatted.push(file);
}

if (dirtyContext)
  console.log(
    'Skipped locally modified PROJECT_CONTEXT.md; a clean checkout checks its committed version.',
  );

if (unformatted.length) {
  for (const file of unformatted) console.error(`[warn] ${file}`);
  console.error(`Code style issues found in ${unformatted.length} versioned file(s).`);
  process.exitCode = 1;
} else {
  console.log(`Checked ${checked} versioned files with Prettier.`);
}
