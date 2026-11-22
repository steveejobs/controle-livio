import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ApiEnvironment } from '@livio/shared';
import {
  recoveryErrorCode,
  sha256,
  type ObjectObservation,
} from '../storage-recovery/storage-recovery.domain';

@Injectable()
export class StorageService {
  private readonly client: SupabaseClient;
  private readonly bucket: string;

  constructor(config: ConfigService<ApiEnvironment, true>) {
    this.bucket = config.get('STORAGE_BUCKET', { infer: true });
    this.client = createClient(
      config.get('SUPABASE_URL', { infer: true }),
      config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true }),
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (input, init) =>
            fetch(input, {
              ...init,
              signal: init?.signal
                ? AbortSignal.any([init.signal, AbortSignal.timeout(12_000)])
                : AbortSignal.timeout(12_000),
            }),
        },
      },
    );
  }

  async upload(key: string, buffer: Buffer, mimeType: string, bucket = this.bucket): Promise<void> {
    const { error } = await this.client.storage.from(bucket).upload(key, buffer, {
      contentType: mimeType,
      cacheControl: '3600',
      upsert: false,
    });
    if (error)
      throw new ServiceUnavailableException('Falha ao armazenar documento privado', {
        cause: error,
      });
  }

  async signedUrl(key: string, expiresInSeconds = 300, bucket = this.bucket): Promise<string> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(key, expiresInSeconds);
    if (error || !data.signedUrl)
      throw new ServiceUnavailableException('Falha ao assinar acesso ao documento');
    return data.signedUrl;
  }

  async download(key: string, bucket = this.bucket): Promise<Buffer> {
    const { data, error } = await this.client.storage.from(bucket).download(key);
    if (error || !data) throw new ServiceUnavailableException('Falha ao ler o documento privado');
    return Buffer.from(await data.arrayBuffer());
  }

  async remove(key: string, bucket = this.bucket): Promise<void> {
    const { error } = await this.client.storage.from(bucket).remove([key]);
    if (error)
      throw new ServiceUnavailableException('Falha ao remover documento privado', { cause: error });
  }

  async inspect(key: string, bucket = this.bucket): Promise<ObjectObservation> {
    try {
      const { data, error } = await this.client.storage.from(bucket).download(key);
      if (!error && data) {
        const bytes = Buffer.from(await data.arrayBuffer());
        return { status: 'PRESENT', size: bytes.length, sha256: sha256(bytes) };
      }
      // RLS-hidden/denied and transport errors are never absence. Recovery ALSO
      // checks storage.objects independently before accepting this observation.
      const provider = error as {
        status?: number;
        statusCode?: number | string;
        code?: string;
        message?: string;
      } | null;
      const status = Number(provider?.statusCode ?? provider?.status);
      if (
        [400, 404].includes(status) &&
        (['NoSuchKey', 'ObjectNotFound', 'not_found'].includes(provider?.code ?? '') ||
          provider?.message === 'Object not found')
      )
        return { status: 'ABSENT' };
      return { status: 'UNKNOWN', code: recoveryErrorCode(error) };
    } catch (error) {
      return { status: 'UNKNOWN', code: recoveryErrorCode(error) };
    }
  }

  async inventory(bucket: string, prefix: string, offset: number, limit = 100) {
    const { data, error } = await this.client.storage.from(bucket).list(prefix, {
      offset,
      limit,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error || !data) throw new ServiceUnavailableException('Inventário privado indisponível');
    return data.map((row) => ({ name: row.name, folder: !row.id }));
  }
}
