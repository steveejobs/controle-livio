import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const token = 'synthetic-only-token-'.repeat(3);
const daemon = createServer((socket) => {
  let input = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    input = Buffer.concat([input, chunk]);
    if (input.length < 14 || !input.subarray(-4).equals(Buffer.alloc(4))) return;
    const infected = input.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'));
    socket.end(infected ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
  });
});
await new Promise((resolve, reject) => {
  daemon.once('error', reject);
  daemon.listen(3310, '127.0.0.1', resolve);
});
const child = spawn(process.execPath, ['tools/scanner/gateway.mjs'], {
  env: { ...process.env, SCANNER_TOKEN: token },
  stdio: 'ignore',
});
try {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch('http://127.0.0.1:8080');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const scan = (body, auth = token) =>
    fetch('http://127.0.0.1:8080/scan', {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth}` },
      body,
    });
  assert.equal((await scan('clean', 'wrong')).status, 401);
  assert.deepEqual(await (await scan('synthetic clean')).json(), { verdict: 'clean' });
  assert.deepEqual(await (await scan('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')).json(), {
    verdict: 'infected',
  });
  await new Promise((r) => daemon.close(r));
  assert.equal((await scan('daemon offline')).status, 503);
  console.log(
    'PASS: gateway auth, clean/infected protocol, offline fail-closed (synthetic TCP daemon; no TLS or real ClamAV proof)',
  );
} finally {
  child.kill();
  daemon.close();
}
