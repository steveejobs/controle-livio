import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

// A real HTTP transport barrier. It never synthesizes a provider response or
// retries the upload: the original buffered request is forwarded exactly once,
// AFTER its client has timed out. Credentials/bytes stay in memory only.
export async function delayedProvider(target, { timeoutMs = 1500, fetchImpl = fetch } = {}) {
  const url = new URL(target);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.equal(url.protocol, 'http:');
  let release,
    reached,
    completed,
    rejected,
    forwarded = false;
  const gate = new Promise((r) => (release = r));
  const received = new Promise((r) => (reached = r));
  const result = new Promise((r, j) => {
    completed = r;
    rejected = j;
  });
  // Attach immediately: errors during client abort must not become unhandled.
  result.catch(() => {});
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, url.pathname + url.search);
      assert.equal(forwarded, false);
      forwarded = true;
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        assert.ok(size <= 65 * 1024 * 1024, 'Synthetic request exceeds barrier budget');
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const headers = { ...req.headers };
      delete headers.host;
      delete headers.connection;
      delete headers['transfer-encoding'];
      reached({ bufferedAt: Date.now(), size });
      await gate;
      // Deliberately independent of the disconnected client signal.
      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(30000),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      let code = null;
      try {
        const body = JSON.parse(bytes.toString());
        const candidate = body.code ?? body.errorCode ?? body.error;
        if (typeof candidate === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(candidate))
          code = candidate;
      } catch {
        /* No raw provider body is exported. */
      }
      completed({ status: response.status, code, providerCompletedAt: Date.now() });
      if (!res.destroyed) {
        res.writeHead(response.status);
        res.end(bytes);
      }
    } catch (error) {
      rejected(error);
      if (!res.destroyed) {
        res.writeHead(502);
        res.end();
      }
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const proxy = new URL(url);
  proxy.port = String(server.address().port);
  proxy.hostname = '127.0.0.1';
  return {
    received,
    result,
    release,
    async request(input, options = {}) {
      const request = new Request(input, options);
      assert.equal(request.url, url.href);
      assert.equal(request.method, 'POST');
      return fetchImpl(proxy, {
        method: request.method,
        headers: request.headers,
        body: await request.arrayBuffer(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    },
    async close() {
      release();
      for (const socket of sockets) socket.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}
