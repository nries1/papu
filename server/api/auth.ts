import type { Request, Response, NextFunction } from 'express';

export const ADMIN_EMAILS = ['nries1@gmail.com', 'avalongoebel@gmail.com'];

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS') {
    next();
    return;
  }

  // Cloudflare injects this header automatically
  const raw = req.headers['cf-access-authenticated-user-email'];
  const userEmail = Array.isArray(raw) ? raw[0] : raw;

  if (!userEmail) {
    res.status(401).json({ error: 'Access Denied: Please log in via Cloudflare.' });
    return;
  }
  if (req.url.includes('/admin') && !ADMIN_EMAILS.includes(userEmail.toLowerCase())) {
    res.status(401).json({ error: 'Access Denied' });
    return;
  }
  req.userEmail = userEmail.toLowerCase();
  next();
}
