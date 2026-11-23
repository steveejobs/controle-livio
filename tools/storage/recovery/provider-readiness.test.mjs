import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { waitRestoredProviders } from './provider-readiness.mjs';

async function server(action, run) {
  const http = createServer(action).listen(0, '127.0.0.1');
  await once(http, 'listening');
  const env = {
    SUPABASE_URL: 'http://127.0.0.1:' + http.address().port,
    SUPABASE_ANON_KEY: 'synthetic-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
  };
  try {
    await run(env);
  } finally {
    http.closeAllConnections();
    await new Promise((done) => http.close(done));
  }
}

test('restored Auth alone cannot pass while real HTTP Storage is still starting', async () => {
  let storageRequests = 0;
  await server(
    (request, response) => {
      if (request.url === '/storage/v1/bucket') {
        assert.equal(request.headers.authorization, 'Bearer synthetic-service');
        response.writeHead(++storageRequests < 3 ? 503 : 200).end('[]');
      } else response.writeHead(200).end('{}');
    },
    async (env) => {
      const result = await waitRestoredProviders(env, { timeoutMs: 2000, pollMs: 5 });
      assert.equal(result.result, 'PASS');
      assert.equal(result.auth, 200);
      assert.equal(result.storage, 200);
      assert.equal(result.attempts, 3);
    },
  );
});

test('persistent Storage failure never becomes a successful empty snapshot', async () => {
  await server(
    (request, response) => {
      response.writeHead(request.url === '/auth/v1/health' ? 200 : 503).end();
    },
    async (env) => {
      await assert.rejects(waitRestoredProviders(env, { timeoutMs: 80, pollMs: 5 }), (error) => {
        assert.equal(error.code, 'RESTORED_PROVIDERS_NOT_READY');
        assert.equal(error.readiness.storage, 503);
        assert.equal(error.readiness.result, 'FAIL');
        assert(!JSON.stringify(error).includes('synthetic-service'));
        return true;
      });
    },
  );
});

test('provider readiness refuses external endpoints before issuing a request', async () => {
  await assert.rejects(
    waitRestoredProviders({
      SUPABASE_URL: 'https://example.invalid',
      SUPABASE_ANON_KEY: 'synthetic',
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic',
    }),
  );
});
