import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import {
  CORRELATION_ID_HEADER,
  normaliseCorrelationId,
  withCorrelationId,
} from './correlation';

/**
 * Opens the correlation scope for an HTTP request and echoes the id back.
 *
 * The response header is not decoration: it is how a customer reporting a
 * failure can hand over something exact instead of a timestamp, and how the
 * browser's network tab lines up with the server logs.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const id = normaliseCorrelationId(req.headers[CORRELATION_ID_HEADER]);
    res.setHeader(CORRELATION_ID_HEADER, id);

    withCorrelationId(id, next);
  }
}
