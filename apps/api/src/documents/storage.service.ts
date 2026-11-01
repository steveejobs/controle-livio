import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ApiEnvironment } from '@livio/shared';

@Injectable()
export class StorageService {
  private readonly client: SupabaseClient;
  private readonly bucket: string;

  constructor(config: ConfigService<ApiEnvironment, true>) {
    this.bucket = config.get('STORAGE_BUCKET', { infer: true });
    this.client = createClient(
      config.get('SUPABASE_URL', { infer: true }),
      config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true }),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }

  async upload(key: string, buffer: Buffer, mimeType: string, bucket = this.bucket): Promise<void> {
    const { error } = await this.client.storage.from(bucket).upload(key, buffer, {
      contentType: mimeType,
      cacheControl: '3600',
      upsert: false,
    });
    if (error) throw new ServiceUnavailableException('Falha ao armazenar documento privado');
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
    await this.client.storage.from(bucket).remove([key]);
  }
}
