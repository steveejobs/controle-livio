// Runs ONLY in an already cached Storage image, --network none, with two
// explicitly mounted disposable volumes/directories. No shell/path expansion.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const failure = (code, message = code) => Object.assign(new Error(message), { code });
export const storageCopyFailureCodes = new Set([
  'STORAGE_COPY_DESTINATION_NOT_EMPTY',
  'STORAGE_COPY_UNSAFE_DESTINATION',
  'STORAGE_COPY_UNSUPPORTED_ENTRY',
  'STORAGE_COPY_HASH_MISMATCH',
  'STORAGE_COPY_IO_ERROR',
]);
export function copyTree(source, destination, { allowEmptyDirectorySkeleton = false } = {}) {
  if (fs.readdirSync(destination).length) {
    if (!allowEmptyDirectorySkeleton)
      throw failure('STORAGE_COPY_DESTINATION_NOT_EMPTY', 'Destination must be empty');
    const verifySkeleton = (relative) => {
      const from = path.join(source, relative),
        to = path.join(destination, relative);
      if (
        !fs.lstatSync(to).isDirectory() ||
        !fs.existsSync(from) ||
        !fs.lstatSync(from).isDirectory()
      )
        throw failure('STORAGE_COPY_UNSAFE_DESTINATION');
      for (const entry of fs.readdirSync(to)) verifySkeleton(path.join(relative, entry));
    };
    verifySkeleton('');
  }
  const inventory = [];
  function copy(relative) {
    const from = path.join(source, relative),
      to = path.join(destination, relative),
      stat = fs.lstatSync(from);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
      throw failure('STORAGE_COPY_UNSUPPORTED_ENTRY');
    if (stat.isDirectory()) {
      if (relative && !fs.existsSync(to)) fs.mkdirSync(to);
      for (const entry of fs.readdirSync(from).sort()) copy(path.join(relative, entry));
    } else {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      const digest = crypto.createHash('sha256').update(fs.readFileSync(from)).digest('hex');
      if (crypto.createHash('sha256').update(fs.readFileSync(to)).digest('hex') !== digest)
        throw failure('STORAGE_COPY_HASH_MISMATCH');
      inventory.push({
        path: relative,
        size: stat.size,
        sha256: digest,
      });
    }
    fs.chmodSync(to, stat.mode);
    if (process.platform !== 'win32') fs.chownSync(to, stat.uid, stat.gid);
    fs.utimesSync(to, stat.atime, stat.mtime);
  }
  copy('');
  return inventory;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, destination, mode] = process.argv.slice(2);
  if (
    source !== '/source' ||
    destination !== '/destination' ||
    process.argv.length > 5 ||
    (mode && mode !== '--allow-empty-directory-skeleton')
  )
    throw new Error('Invalid volume roots');
  try {
    process.stdout.write(
      JSON.stringify(
        copyTree(source, destination, {
          allowEmptyDirectorySkeleton: mode === '--allow-empty-directory-skeleton',
        }),
      ),
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        failure: storageCopyFailureCodes.has(error.code) ? error.code : 'STORAGE_COPY_IO_ERROR',
      }),
    );
    process.exitCode = 1;
  }
}
