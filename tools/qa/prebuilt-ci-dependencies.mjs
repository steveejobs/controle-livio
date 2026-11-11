// Disposable CI dependencies: official prebuilt artifacts, no APT or cloud credentials.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(join(process.cwd(), 'package.json'));
const image =
  'mcr.microsoft.com/playwright:v1.64.1-noble@sha256:ee15712262f017b8157421b212b12099146645f44b1bc5c0514cbbe6a229b1d0';
// Browser version observed in the verified immutable image, not the host install manifest.
const imageChromium = '156.0.8078.80';
const qpdfHash = 'db367d897829f22c4198ce1094143c9d467bd6ee7dfabc44ba6f02056b24f8b1';
const coreDir = dirname(require.resolve('playwright-core/package.json'));
const { yauzl } = require(join(coreDir, 'lib/utilsBundle.js'));

function archivePath(value) {
  if (
    !value ||
    /[\\:]/.test(value) ||
    [...value].some((char) => char.charCodeAt(0) < 32) ||
    value.startsWith('/') ||
    value.split('/').includes('..')
  )
    throw new Error('Unsafe ZIP path.');
  const normalized = posix.normalize(value);
  if (!/^(bin|lib)\//.test(normalized) || normalized === 'bin/' || normalized === 'lib/') {
    if (value !== 'bin/' && value !== 'lib/') throw new Error('Unexpected ZIP layout.');
  }
  return normalized;
}

async function zipEntries(archive) {
  return new Promise((resolveEntries, reject) => {
    yauzl.open(archive, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(error);
      const entries = [];
      let total = 0;
      zip.on('error', reject);
      zip.on('end', () => resolveEntries(entries));
      zip.on('entry', async (entry) => {
        try {
          const name = archivePath(entry.fileName);
          total += entry.uncompressedSize;
          if (total > 64 * 1024 * 1024) throw new Error('ZIP exceeds extraction limit.');
          const mode = entry.externalFileAttributes >>> 16;
          const type = name.endsWith('/')
            ? 'directory'
            : (mode & 0o170000) === 0o120000
              ? 'link'
              : 'file';
          if (
            type !== 'directory' &&
            mode & 0o170000 &&
            ![0o100000, 0o120000].includes(mode & 0o170000)
          )
            throw new Error('Unsupported ZIP entry type.');
          const data =
            type === 'directory'
              ? Buffer.alloc(0)
              : await new Promise((done, fail) => {
                  zip.openReadStream(entry, (streamError, stream) => {
                    if (streamError) return fail(streamError);
                    const chunks = [];
                    stream.on('data', (chunk) => chunks.push(chunk));
                    stream.once('error', fail);
                    stream.once('end', () => done(Buffer.concat(chunks)));
                  });
                });
          entries.push({ name, type, data, mode });
          zip.readEntry();
        } catch (entryError) {
          zip.close();
          reject(entryError);
        }
      });
      zip.readEntry();
    });
  });
}

async function extractQpdf(archive, install) {
  const entries = await zipEntries(archive);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  if (byName.size !== entries.length) throw new Error('Duplicate ZIP entry.');
  for (const entry of entries) {
    const parts = entry.name.replace(/\/$/, '').split('/');
    for (let i = 1; i < parts.length; i++) {
      const parent = byName.get(parts.slice(0, i).join('/'));
      if (parent && parent.type !== 'directory') throw new Error('ZIP parent is not a directory.');
    }
    if (entry.type === 'link') {
      const target = entry.data.toString('utf8');
      if (
        !target ||
        /[\\:]/.test(target) ||
        [...target].some((char) => char.charCodeAt(0) < 32) ||
        posix.isAbsolute(target)
      )
        throw new Error('Unsafe ZIP link.');
      const resolved = archivePath(posix.join(posix.dirname(entry.name), target));
      if (byName.get(resolved)?.type !== 'file')
        throw new Error('ZIP link must target a regular packaged file.');
    }
  }
  mkdirSync(install);
  // All paths and links are checked before writing; links are created last.
  for (const entry of entries.filter((entry) => entry.type !== 'link')) {
    const destination = join(install, entry.name);
    if (entry.type === 'directory') mkdirSync(destination, { recursive: true });
    else {
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, entry.data, {
        flag: 'wx',
        mode: entry.mode & 0o111 ? 0o755 : 0o644,
      });
    }
  }
  for (const entry of entries.filter((entry) => entry.type === 'link')) {
    symlinkSync(entry.data.toString('utf8'), join(install, entry.name));
    if (!realpathSync(join(install, entry.name)).startsWith(`${resolve(install)}${sep}`))
      throw new Error('Extracted link escapes installation.');
  }
  return entries.map(({ name, type }) => ({ name, type }));
}

function elfDependencies(file) {
  const bytes = readFileSync(file);
  if (bytes.toString('hex', 0, 6) !== '7f454c460201')
    throw new Error('Expected ELF64 little-endian artifact.');
  const offset = Number(bytes.readBigUInt64LE(40));
  const size = bytes.readUInt16LE(58);
  const sections = Array.from({ length: bytes.readUInt16LE(60) }, (_, i) => {
    const start = offset + i * size;
    return {
      type: bytes.readUInt32LE(start + 4),
      offset: Number(bytes.readBigUInt64LE(start + 24)),
      size: Number(bytes.readBigUInt64LE(start + 32)),
      link: bytes.readUInt32LE(start + 40),
    };
  });
  const dynamic = sections.find((section) => section.type === 6);
  if (!dynamic) throw new Error('Missing ELF dynamic section.');
  const strings = sections[dynamic.link];
  const result = [];
  for (let start = dynamic.offset; start < dynamic.offset + dynamic.size; start += 16) {
    const tag = Number(bytes.readBigInt64LE(start));
    if (![1, 15, 29].includes(tag)) continue;
    const value = strings.offset + Number(bytes.readBigUInt64LE(start + 8));
    result.push({ tag, value: bytes.toString('utf8', value, bytes.indexOf(0, value)) });
  }
  return result;
}

if (
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.platform !== 'linux' ||
  process.arch !== 'x64'
) {
  throw new Error('Requires the disposable GitHub Linux/amd64 runner.');
}
if (!process.version.startsWith('v24.')) throw new Error('Node 24 required.');
for (const key of ['RUNNER_TEMP', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB']) {
  if (!process.env[key] || /[\r\n]/.test(process.env[key])) throw new Error(`Invalid ${key}`);
}
const suffix = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-${process.env.GITHUB_JOB}`;
if (!/^[a-zA-Z0-9_-]+$/.test(suffix)) throw new Error('Invalid container suffix.');
const name = `livio-playwright-${suffix}`;
const state = join(process.env.RUNNER_TEMP, 'livio-prebuilt-dependencies');
mkdirSync(state, { recursive: true });
const output = join(process.env.RUNNER_TEMP, 'livio-integrated-artifacts');
mkdirSync(output, { recursive: true });
const command = process.argv[2];
const evidence = { command, node: process.version, image, status: 'FAIL' };
const run = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 120_000 });
function exportLine(file, line) {
  if (!file || /[\r\n]/.test(line)) throw new Error('Invalid Actions export.');
  appendFileSync(file, `${line}\n`);
}

async function startBrowserServer() {
  const node = realpathSync(process.execPath);
  run('docker', [
    'run',
    '--detach',
    '--rm',
    '--init',
    '--name',
    name,
    '--platform=linux/amd64',
    '--user=pwuser',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--shm-size=1g',
    '--memory=4g',
    '--cpus=2',
    '--pids-limit=512',
    '--publish=127.0.0.1:3100:3100',
    '--mount',
    `type=bind,source=${node},target=/livio-node24,readonly`,
    '--mount',
    `type=bind,source=${coreDir},target=/livio-playwright,readonly`,
    image,
    '/livio-node24',
    '/livio-playwright/cli.js',
    'run-server',
    '--host=0.0.0.0',
    '--port=3100',
  ]);
  const created = JSON.parse(run('docker', ['container', 'inspect', name]))[0];
  evidence.activeContainer = { id: created.Id, name: created.Name, state: created.State.Status };
  evidence.containerRemoved = false;
  // No workspace, Docker socket, credential mounts or inherited host environment.
  evidence.serverNode = run('docker', ['exec', name, '/livio-node24', '--version']).trim();
  if (!evidence.serverNode.startsWith('v24.')) throw new Error('Browser server must use Node 24.');
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const r = await fetch('http://127.0.0.1:3100/', {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {
      /* bounded readiness poll; final failure remains fatal */
    }
    await delay(500);
  }
  if (!ready) throw new Error('Playwright server did not become ready.');
  const serverPackage = JSON.parse(
    run('docker', [
      'exec',
      name,
      '/livio-node24',
      '-e',
      "process.stdout.write(JSON.stringify(require('/livio-playwright/package.json')))",
    ]),
  );
  evidence.serverPlaywright = serverPackage.version;
  if (serverPackage.version !== '1.64.1') throw new Error('Server Playwright version mismatch.');
}

async function browser() {
  const core = require('playwright-core/package.json');
  evidence.clientPlaywright = core.version;
  evidence.hostChromiumManifest = JSON.parse(
    readFileSync(join(coreDir, 'browsers.json'), 'utf8'),
  ).browsers.find((entry) => entry.name === 'chromium').browserVersion;
  evidence.expectedImageChromium = imageChromium;
  if (core.version !== '1.64.1') throw new Error('Playwright/image version mismatch.');
  run('docker', ['pull', '--platform=linux/amd64', image]);
  const pulled = JSON.parse(run('docker', ['image', 'inspect', image]))[0];
  const digest = image.slice(image.indexOf('@') + 1);
  if (
    pulled.Os !== 'linux' ||
    pulled.Architecture !== 'amd64' ||
    !pulled.RepoDigests.some((value) => value.endsWith(`@${digest}`))
  )
    throw new Error('Docker platform or digest mismatch.');
  evidence.dockerImage = {
    id: pulled.Id,
    repoDigests: pulled.RepoDigests,
    os: pulled.Os,
    architecture: pulled.Architecture,
  };
  await startBrowserServer();
  const controlledFailure = new Error('Synthetic bootstrap failure for cleanup verification.');
  try {
    throw controlledFailure;
  } catch (error) {
    if (error !== controlledFailure) throw error;
  } finally {
    await stopBrowserServer();
  }
  evidence.cleanupAfterControlledFailure = 'PASS';
  await startBrowserServer();
  const probeBytes = Buffer.from('LIVIO synthetic upload and download\n');
  let multipartReceived = false;
  const server = createServer((request, response) => {
    if (request.url === '/download') {
      response.setHeader('Content-Disposition', 'attachment; filename="synthetic.txt"');
      return response.end(probeBytes);
    }
    if (request.url === '/upload' && request.method === 'POST') {
      const chunks = [];
      let size = 0;
      request.on('data', (chunk) => {
        size += chunk.length;
        if (size > 16384) request.destroy();
        else chunks.push(chunk);
      });
      request.on('end', () => {
        const body = Buffer.concat(chunks);
        multipartReceived =
          request.headers['content-type']?.startsWith('multipart/form-data;') &&
          request.headers.cookie?.includes('livio_probe=synthetic') &&
          body.includes(probeBytes) &&
          body.includes(Buffer.from('synthetic.txt'));
        response.statusCode = multipartReceived ? 200 : 400;
        response.end(multipartReceived ? 'upload-ok' : 'upload-failed');
      });
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.setHeader('Set-Cookie', 'livio_probe=synthetic; HttpOnly; SameSite=Lax; Path=/');
    response.end(
      '<p>livio-loopback-probe</p><a href="/download">download</a><form method="POST" enctype="multipart/form-data" action="/upload"><input type="file" name="fixture"><button>upload</button></form>',
    );
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(3198, '127.0.0.1', resolve);
  });
  let remote;
  try {
    remote = await require('playwright-core').chromium.connect('ws://127.0.0.1:3100/', {
      exposeNetwork: '<loopback>',
      timeout: 15_000,
    });
    await verifyBrowserRuntime(remote);
    evidence.chromium = remote.version();
    const expected = JSON.parse(readFileSync(join(coreDir, 'browsers.json'), 'utf8')).browsers.find(
      (b) => b.name === 'chromium',
    ).browserVersion;
    evidence.hostChromiumManifest = expected;
    evidence.expectedImageChromium = imageChromium;
    if (evidence.chromium !== imageChromium)
      throw new Error('Pinned image Chromium version mismatch.');
    const context = await remote.newContext({ acceptDownloads: true });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:3198/', { timeout: 15_000 });
    if ((await page.textContent('p')) !== 'livio-loopback-probe')
      throw new Error('Loopback bridge failed.');
    evidence.loopback = 'PASS';
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByRole('link', { name: 'download' }).click(),
    ]);
    const downloaded = join(state, 'download.txt');
    await download.saveAs(downloaded);
    if ((await download.failure()) || !readFileSync(downloaded).equals(probeBytes))
      throw new Error('Remote download mismatch.');
    evidence.download = 'PASS';
    await page
      .locator('input')
      .setInputFiles({ name: 'synthetic.txt', mimeType: 'text/plain', buffer: probeBytes });
    await Promise.all([
      page.waitForURL('**/upload', { timeout: 15_000 }),
      page.getByRole('button', { name: 'upload' }).click(),
    ]);
    if (!multipartReceived || (await page.textContent('body')) !== 'upload-ok')
      throw new Error('Remote multipart/cookie mismatch.');
    evidence.uploadAndCookie = 'PASS';
    const screenshot = await page.screenshot({ path: join(output, 'ci-prebuilt-probe.png') });
    if (screenshot.toString('hex', 0, 8) !== '89504e470d0a1a0a')
      throw new Error('Remote screenshot missing.');
    await context.tracing.stop({ path: join(output, 'ci-prebuilt-probe-trace.zip') });
    const trace = readFileSync(join(output, 'ci-prebuilt-probe-trace.zip'));
    if (trace.length < 100 || trace.toString('ascii', 0, 2) !== 'PK')
      throw new Error('Remote trace missing.');
    evidence.screenshotAndTrace = 'PASS';
    await context.close();
  } finally {
    await remote?.close();
    await new Promise((resolve) => server.close(resolve));
  }
  await stopBrowserServer();
  evidence.cleanupAfterSuccess = 'PASS';
  await startBrowserServer();
  const finalRemote = await require('playwright-core').chromium.connect('ws://127.0.0.1:3100/', {
    exposeNetwork: '<loopback>',
    timeout: 15_000,
  });
  try {
    await verifyBrowserRuntime(finalRemote);
  } finally {
    await finalRemote.close();
  }
  exportLine(process.env.GITHUB_ENV, 'PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:3100/');
  exportLine(process.env.GITHUB_ENV, 'PW_TEST_CONNECT_EXPOSE_NETWORK=<loopback>');
}

async function qpdf() {
  const url =
    'https://github.com/qpdf/qpdf/releases/download/v12.4.2/qpdf-12.4.2-bin-linux-x86_64.zip';
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Official qpdf download HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== qpdfHash)
    throw new Error('qpdf SHA-256 mismatch.');
  const archive = join(state, 'qpdf.zip');
  const install = join(state, 'qpdf-12.4.2');
  if (existsSync(install)) throw new Error('qpdf target already exists.');
  writeFileSync(archive, bytes, { flag: 'wx' });
  evidence.archiveEntries = await extractQpdf(archive, install);
  const executable = join(install, 'bin', 'qpdf');
  evidence.qpdfSha256 = qpdfHash;
  evidence.elf = elfDependencies(executable);
  if (
    !evidence.elf.some(
      (entry) => [15, 29].includes(entry.tag) && entry.value.includes('$ORIGIN/../lib'),
    )
  )
    throw new Error('qpdf RUNPATH must resolve packaged libraries.');
  evidence.dependencies = run('ldd', [executable]).trim();
  if (evidence.dependencies.includes('not found')) throw new Error('Missing qpdf dependency.');
  evidence.qpdfVersion = run(executable, ['--version']).trim();
  if (!evidence.qpdfVersion.startsWith('qpdf version 12.4.2\n'))
    throw new Error('qpdf version mismatch.');
  const { PDFDocument } = require('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('LIVIO synthetic dependency probe');
  const valid = join(state, 'valid.pdf');
  const invalid = join(state, 'invalid.pdf');
  writeFileSync(valid, await pdf.save(), { flag: 'wx' });
  writeFileSync(invalid, 'invalid synthetic PDF', { flag: 'wx' });
  evidence.validPdf = run(executable, ['--check', valid]).trim();
  const rejected = spawnSync(executable, ['--check', invalid], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (rejected.error || rejected.status !== 2)
    throw new Error('qpdf must reject invalid PDF with exit 2.');
  evidence.invalidPdfExit = rejected.status;
  exportLine(process.env.GITHUB_PATH, join(install, 'bin'));
}

async function waitForBrowserRemoval() {
  evidence.containerRemoved = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const remaining = run('docker', [
      'ps',
      '-a',
      '--filter',
      `name=^/${name}$`,
      '--format={{.Names}}',
    ]).trim();
    evidence.removalChecks = attempt + 1;
    if (!remaining) {
      evidence.containerRemoved = true;
      return;
    }
    if (remaining !== name) throw new Error('Unexpected container identity during cleanup.');
    await delay(100);
  }
  throw new Error('Browser container remained after bounded removal wait.');
}

async function verifyBrowserRuntime(remote) {
  const cdp = await remote.newBrowserCDPSession();
  try {
    const version = await cdp.send('Browser.getVersion');
    const command = await cdp.send('Browser.getBrowserCommandLine');
    const manifest = JSON.parse(readFileSync(join(coreDir, 'browsers.json'), 'utf8'));
    const revision = manifest.browsers.find(
      (entry) => entry.name === 'chromium-headless-shell',
    ).revision;
    const expected = `/ms-playwright/chromium_headless_shell-${revision}/chrome-headless-shell-linux64/chrome-headless-shell`;
    const executable = command.arguments[0];
    evidence.browserProtocol = { ...version, executable, expectedExecutable: expected };
    evidence.expectedImageChromium = imageChromium;
    evidence.chromium = remote.version();
    if (
      executable !== expected ||
      !version.protocolVersion ||
      !version.product.endsWith(`/${imageChromium}`) ||
      evidence.chromium !== imageChromium
    )
      throw new Error('Pinned Chromium executable, version or protocol mismatch.');
    const probe =
      "const fs=require('fs'),crypto=require('crypto'); const p=fs.realpathSync(process.argv[1]); if(!p.startsWith('/ms-playwright/'))throw Error('Executable outside image browsers'); process.stdout.write(JSON.stringify({path:p,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}));";
    evidence.browserExecutable = JSON.parse(
      run('docker', ['exec', name, '/livio-node24', '-e', probe, executable]),
    );
    evidence.browserComparison = 'PASS';
  } finally {
    await cdp.detach();
  }
}

async function stopBrowserServer() {
  const names = run('docker', [
    'ps',
    '-a',
    '--filter',
    `name=^/${name}$`,
    '--format={{.Names}}',
  ]).trim();
  if (names && names !== name) throw new Error('Unexpected container identity.');
  if (names === name) {
    const container = JSON.parse(run('docker', ['container', 'inspect', name]))[0];
    if (container.Name !== `/${name}` || container.Config.Image !== image)
      throw new Error('Refusing to stop an unrelated container.');
    const record = {
      id: container.Id,
      name: container.Name,
      image: container.Config.Image,
      stateBeforeStop: container.State.Status,
    };
    (evidence.cleanup ??= []).push(record);
    try {
      run('docker', ['logs', container.Id]);
    } finally {
      run('docker', ['stop', container.Id]);
    }
    record.stopRequested = true;
  }
  await waitForBrowserRemoval();
}

try {
  if (command === 'browser') await browser();
  else if (command === 'qpdf') await qpdf();
  else if (command === 'stop') await stopBrowserServer();
  else throw new Error('Expected browser, qpdf or stop.');
  evidence.status = 'PASS';
} catch (error) {
  evidence.error = error.message;
  process.exitCode = 1;
} finally {
  writeFileSync(
    join(output, `ci-prebuilt-${command}.json`),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(JSON.stringify(evidence));
}
