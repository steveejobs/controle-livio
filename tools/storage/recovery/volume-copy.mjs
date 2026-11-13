// Runs ONLY in an already cached Storage image, --network none, with two
// explicitly mounted disposable volumes/directories. No shell/path expansion.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
export function copyTree(source, destination) {
  if (fs.readdirSync(destination).length) throw new Error('Destination must be empty');
  const inventory = [];
  function copy(relative) {
    const from = path.join(source, relative),
      to = path.join(destination, relative),
      stat = fs.lstatSync(from);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
      throw new Error('Unsupported Storage entry');
    if (stat.isDirectory()) {
      if (relative) fs.mkdirSync(to);
      for (const entry of fs.readdirSync(from).sort()) copy(path.join(relative, entry));
    } else {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      const digest = crypto.createHash('sha256').update(fs.readFileSync(from)).digest('hex');
      if (crypto.createHash('sha256').update(fs.readFileSync(to)).digest('hex') !== digest)
        throw new Error('Destination bytes differ after copy');
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
  const [source, destination] = process.argv.slice(2);
  if (source !== '/source' || destination !== '/destination')
    throw new Error('Invalid volume roots');
  process.stdout.write(JSON.stringify(copyTree(source, destination)));
}
