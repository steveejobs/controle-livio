import { createConnection } from 'node:net';
import { get } from 'node:http';

const httpReady = new Promise((resolve) => {
  const req = get('http://127.0.0.1:8080/health', (res) => {
    res.resume();
    resolve(res.statusCode === 401);
  });
  req.setTimeout(2_000, () => req.destroy());
  req.once('error', () => resolve(false));
});
const daemonReady = new Promise((resolve) => {
  const socket = createConnection({ host: '127.0.0.1', port: 3310 });
  let output = '';
  socket.setTimeout(2_000, () => socket.destroy());
  socket.once('connect', () => socket.write('zPING\0'));
  socket.on('data', (chunk) => {
    output += chunk.toString('utf8');
    if (output.includes('\0') || output.length > 64) {
      resolve(output === 'PONG\0');
      socket.destroy();
    }
  });
  socket.once('error', () => resolve(false));
  socket.once('close', () => resolve(false));
});

process.exitCode = (await httpReady) && (await daemonReady) ? 0 : 1;
