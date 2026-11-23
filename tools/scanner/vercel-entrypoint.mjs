import { spawn } from 'node:child_process';
import { cp, mkdir, open } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { createScannerServer } from './gateway.mjs';
import { definitionAge } from './signature-header.mjs';

const children = new Set();
let stopping = false;
const started = Date.now();
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

function run(program, args) {
  // Scanner diagnostics contain no request bodies, credentials or client filenames.
  const child = spawn(program, args, { stdio: ['ignore', 'ignore', 'ignore'] });
  children.add(child);
  child.once('error', () => child.emit('scannerExit'));
  child.once('exit', () => {
    children.delete(child);
    child.emit('scannerExit');
  });
  return child;
}

async function definitionsFresh() {
  const file = await open('/tmp/clamav/daily.cld').catch(() => open('/tmp/clamav/daily.cvd'));
  const data = Buffer.alloc(512);
  try {
    await file.read(data, 0, 512, 0);
  } finally {
    await file.close();
  }
  // CVD headers are fixed-width ASCII; the signature timestamp is field 8 (Unix seconds).
  return definitionAge(data);
}

function ping() {
  return new Promise((done) => {
    const socket = createConnection({ host: '127.0.0.1', port: 3310 });
    let value = '';
    const finish = (ok) => {
      socket.destroy();
      done(ok);
    };
    socket.setTimeout(1000, () => finish(false));
    socket.once('error', () => finish(false));
    socket.once('connect', () => socket.write('zPING\0'));
    socket.on('data', (chunk) => {
      value += chunk.toString('ascii');
      if (value.includes('\0') || value.length > 32) finish(value === 'PONG\0');
    });
    socket.once('close', () => done(false));
  });
}

let daemon;
let lastVendorCheck = 0;
let refreshRequested = false;
// Operational refresh is local to the process; it is never an HTTP/client option.
process.on('SIGUSR1', () => {
  refreshRequested = true;
});
const maintenanceStops = new WeakSet();
async function startDaemon() {
  daemon = run('clamd', ['--config-file=/app/clamd-vercel.conf', '--foreground']);
  const current = daemon;
  daemon.once('scannerExit', () => {
    if (!stopping && !maintenanceStops.has(current)) {
      console.error(JSON.stringify({ scanner: 'daemon-exited' }));
      process.exitCode = 1;
      stop();
    }
  });
  const deadline = Date.now() + 150_000;
  while (!(await ping())) {
    if (daemon.exitCode !== null || Date.now() > deadline)
      throw new Error('Scanner startup failed');
    await pause(200);
  }
}

async function updateDefinitions() {
  // Stop the old engine before freshclam load-tests the new database: no double engine.
  if (daemon && daemon.exitCode === null) {
    maintenanceStops.add(daemon);
    const exited = new Promise((done) => daemon.once('exit', done));
    daemon.kill('SIGTERM');
    await exited;
  }
  const update = run('freshclam', ['--config-file=/app/freshclam-vercel.conf']);
  const result = await Promise.race([
    new Promise((done) => update.once('exit', done)),
    pause(120_000).then(() => {
      update.kill('SIGTERM');
      return -1;
    }),
  ]);
  if (result !== 0) throw new Error('Scanner database update failed');
  await definitionsFresh();
  lastVendorCheck = Date.now();
}

let ready = (async () => {
  await mkdir('/tmp/clamav', { recursive: true });
  await cp('/var/lib/clamav', '/tmp/clamav', { recursive: true });
  const age = await definitionsFresh().catch(() => Infinity);
  if (age > 6 * 3600_000) await updateDefinitions();
  else lastVendorCheck = Date.now();
  await startDaemon();
  console.log(JSON.stringify({ scanner: 'ready', startupMs: Date.now() - started }));
})();
// Observe failure immediately; each request still fails closed through beforeScan.
ready.catch(() => {
  console.error(JSON.stringify({ scanner: 'initialization-failed' }));
  process.exitCode = 1;
  stop();
});

const server = createScannerServer({
  beforeScan: async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50_000);
    try {
      const check = async () => {
        await ready;
        const age = await definitionsFresh().catch(() => Infinity);
        if (
          refreshRequested ||
          age === Infinity ||
          (age > 6 * 3600_000 && Date.now() - lastVendorCheck > 6 * 3600_000)
        ) {
          refreshRequested = false;
          ready = updateDefinitions()
            .then(startDaemon)
            .catch((error) => {
              process.exitCode = 1;
              stop();
              throw error;
            });
          await ready;
        }
      };
      await Promise.race([
        check(),
        new Promise((_, reject) =>
          controller.signal.addEventListener('abort', () => reject(new Error('Scanner not ready'))),
        ),
      ]);
      await definitionsFresh();
    } finally {
      clearTimeout(timer);
    }
  },
});
server.listen(Number(process.env.PORT || 8080), '0.0.0.0');

function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(process.exitCode ?? 0), 2000).unref();
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
