import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    userEmail?: string;
    requestId?: string;
    startTime?: number;
  }
}
