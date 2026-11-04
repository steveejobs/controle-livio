import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';

export async function scanHttps(
  file: Buffer,
  endpoint: string,
  token: string,
  timeoutMs: number,
): Promise<void> {
  try {
    const url = new URL(endpoint);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      token.length < 32
    )
      throw new Error('configuration');
    const signal = AbortSignal.timeout(timeoutMs);
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(file),
    });
    if (
      response.status !== 200 ||
      response.headers.get('content-type')?.split(';')[0] !== 'application/json'
    )
      throw new Error('response');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('body');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 1024) throw new Error('size');
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (
      !result ||
      typeof result !== 'object' ||
      Object.keys(result).length !== 1 ||
      !('verdict' in result)
    )
      throw new Error('verdict');
    if (result.verdict === 'infected')
      throw new UnprocessableEntityException(
        'O arquivo foi bloqueado pela verificação de segurança.',
      );
    if (result.verdict !== 'clean') throw new Error('verdict');
  } catch (error) {
    if (error instanceof UnprocessableEntityException) throw error;
    throw new ServiceUnavailableException('A varredura de segurança não pôde ser concluída.');
  }
}
