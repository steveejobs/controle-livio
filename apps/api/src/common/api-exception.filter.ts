import type { Request, Response } from 'express';
import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import { Prisma } from '@livio/db';
import type { ApiErrorBody } from '@livio/shared';

export function sanitizeRequestPath(path: string): string {
  const pathname = path.split('?', 1)[0] || '/';
  return pathname.replace(/(\/public\/signatures\/)[^/?#]+(?=\/|$)/g, '$1[REDACTED]');
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const isHttpException = exception instanceof HttpException;
    const databaseError = isHttpException ? undefined : this.databaseError(exception);
    const status = isHttpException
      ? exception.getStatus()
      : (databaseError?.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    const exceptionResponse = isHttpException ? exception.getResponse() : undefined;
    const safeMessage = isHttpException
      ? this.messageFor(status, exceptionResponse)
      : (databaseError?.message ?? this.messageFor(status, undefined));
    const requestId = String(request.headers['x-request-id'] ?? request.id ?? 'unknown');
    const body: ApiErrorBody = {
      statusCode: status,
      code: this.codeFor(status),
      message: safeMessage,
      requestId,
      timestamp: new Date().toISOString(),
      path: sanitizeRequestPath(request.originalUrl),
    };

    if (status >= 500) {
      // Exceptions may embed signed URLs, SQL parameters and financial payloads.
      // Keep correlation and classification without serializing untrusted error data.
      request.log?.error({ requestId, statusCode: status }, 'Falha não tratada');
    }
    response.status(status).json(body);
  }

  private messageFor(status: number, payload: string | object | undefined): string {
    if (status >= 500) return 'Ocorreu um erro interno';
    if (typeof payload === 'string') return payload;
    if (payload && 'message' in payload) {
      const message = payload.message;
      return Array.isArray(message) ? message.join('; ') : String(message);
    }
    return 'Não foi possível processar a solicitação';
  }

  private codeFor(status: number): string {
    return HttpStatus[status]?.toString().toLowerCase() ?? 'request_error';
  }

  private databaseError(exception: unknown): { status: number; message: string } | undefined {
    if (!(exception instanceof Prisma.PrismaClientKnownRequestError)) return undefined;

    switch (exception.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          message:
            'Já existe um registro com esses dados. Confira as informações e tente novamente.',
        };
      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          message:
            'Um vínculo relacionado mudou ou não está disponível. Atualize a tela e tente novamente.',
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'O registro não foi encontrado. Atualize a tela e tente novamente.',
        };
      case 'P2034':
        return {
          status: HttpStatus.CONFLICT,
          message: 'Os dados mudaram durante a operação. Atualize a tela e tente novamente.',
        };
      default:
        return undefined;
    }
  }
}
