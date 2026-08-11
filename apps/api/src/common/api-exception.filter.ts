import type { Request, Response } from 'express';
import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiErrorBody } from '@livio/shared';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = isHttpException ? exception.getResponse() : undefined;
    const safeMessage = this.messageFor(status, exceptionResponse);
    const requestId = String(request.headers['x-request-id'] ?? request.id ?? 'unknown');
    const body: ApiErrorBody = {
      statusCode: status,
      code: this.codeFor(status),
      message: safeMessage,
      requestId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    };

    if (status >= 500) {
      request.log?.error({ err: exception, requestId }, 'Falha não tratada');
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
}
