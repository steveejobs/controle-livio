import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { timingSafeEqual } from 'node:crypto';

// Bind only to loopback; an HTTPS reverse proxy must terminate TLS on this host.
const token = process.env.SCANNER_TOKEN;
if (!token || token.length < 32) throw new Error('SCANNER_TOKEN requires 32 characters');
let active = false;
const server = createServer(async (req, res) => {
  const reply = (status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  const provided = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    reply(401, {});
    return;
  }
  if (req.method !== 'POST' || req.url !== '/scan') {
    reply(404, {});
    return;
  }
  if (active) {
    reply(503, {});
    return;
  }
  active = true;
  const deadline = setTimeout(() => req.destroy(), 9000);
  let socket;
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        reply(413, {});
        return;
      }
      chunks.push(chunk);
    }
    clearTimeout(deadline);
    const verdict = await new Promise((resolve, reject) => {
      socket = createConnection({ host: '127.0.0.1', port: 3310 });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('timeout'));
      }, 8000);
      let output = '';
      const fail = () => {
        clearTimeout(timer);
        reject(new Error('scanner'));
      };
      socket.once('error', fail);
      socket.once('close', fail);
      socket.once('connect', () => {
        socket.write('zINSTREAM\0');
        for (const chunk of chunks) {
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
      socket.on('data', (chunk) => {
        output += chunk.toString('utf8');
        if (output.length > 1024) {
          socket.destroy();
          fail();
          return;
        }
        if (!output.includes('\0')) return;
        clearTimeout(timer);
        const value = output.slice(0, output.indexOf('\0'));
        if (value === 'stream: OK') resolve('clean');
        else if (/^stream: .+ FOUND$/.test(value)) resolve('infected');
        else reject(new Error('invalid'));
        socket.destroy();
      });
    });
    reply(200, { verdict });
  } catch {
    if (!res.headersSent && !res.destroyed) reply(503, {});
  } finally {
    clearTimeout(deadline);
    socket?.destroy();
    active = false;
  }
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.listen(8080, '127.0.0.1');
