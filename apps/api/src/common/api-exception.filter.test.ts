import { HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@livio/db';
import { describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from './api-exception.filter';

function filterResponse(exception: unknown) {
  const request = {
    headers: {},
    id: 'request-a',
    originalUrl: '/v1/records',
    log: { error: vi.fn() },
  };
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  new ApiExceptionFilter().catch(exception, host);

  return { request, response };
}

describe('ApiExceptionFilter', () => {
  it.each([
    [
      'P2002',
      HttpStatus.CONFLICT,
      'Já existe um registro com esses dados. Confira as informações e tente novamente.',
    ],
    [
      'P2003',
      HttpStatus.CONFLICT,
      'Um vínculo relacionado mudou ou não está disponível. Atualize a tela e tente novamente.',
    ],
    [
      'P2025',
      HttpStatus.NOT_FOUND,
      'O registro não foi encontrado. Atualize a tela e tente novamente.',
    ],
    [
      'P2034',
      HttpStatus.CONFLICT,
      'Os dados mudaram durante a operação. Atualize a tela e tente novamente.',
    ],
  ])('converts database error %s into a safe response', (code, status, message) => {
    const error = new Prisma.PrismaClientKnownRequestError('Database detail must stay private', {
      code,
      clientVersion: '6.19.3',
      meta: { target: ['organization_id', 'reference'] },
    });

    const { request, response } = filterResponse(error);

    expect(response.status).toHaveBeenCalledWith(status);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: status, message, requestId: 'request-a' }),
    );
    expect(response.json.mock.calls[0]?.[0]).not.toHaveProperty('meta');
    expect(request.log.error).not.toHaveBeenCalled();
  });

  it('keeps unexpected errors generic and logs them for investigation', () => {
    const error = new Error('private database detail');
    const { request, response } = filterResponse(error);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Ocorreu um erro interno',
      }),
    );
    expect(JSON.stringify(response.json.mock.calls[0]?.[0])).not.toContain(
      'private database detail',
    );
    expect(request.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: error, requestId: 'request-a' }),
      'Falha não tratada',
    );
  });
});
