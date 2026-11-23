import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sourcePaths = [
  'apps',
  'packages',
  'supabase',
  'tools',
  'package.json',
  'package-lock.json',
  'prisma.config.ts',
  'tsconfig.base.json',
];

export function verifyUpload(root = process.cwd()) {
  const list = (extra = []) =>
    execFileSync('git', ['ls-files', '-z', ...extra, '--', ...sourcePaths], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    })
      .split('\0')
      .filter(Boolean);
  const sources = list();
  if (!sources.length) throw new Error('No versioned sources found; run inside the repository.');
  // --exclude-from alone uses this file, without merging .gitignore/global rules.
  const excluded = list(['--cached', '--ignored', '--exclude-from=.vercelignore']);
  if (excluded.length)
    throw new Error('Vercel upload excludes versioned source files: ' + excluded.join(', '));
  return { result: 'PASS', checkedSources: sources.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(verifyUpload()));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
