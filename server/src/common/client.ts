import type { Request } from 'express';

/**
 * Who is calling, for the logs and the rate limiter.
 *
 * `req.ip` is Express's answer, which is only trustworthy because main.ts set
 * `trust proxy` to a hop count rather than `true`. With `true`, Express walks
 * X-Forwarded-For to the leftmost entry — an attacker-controlled value — and
 * a caller could pick which address gets rate-limited and which one appears
 * in your admin panel.
 *
 * The chain is Cloudflare -> nginx -> here. nginx is configured to set
 * X-Forwarded-For from CF-Connecting-IP, so the one hop we trust is the one
 * we run. See deploy/nginx-7qob.dev.conf.
 */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/**
 * Truncated hard. This is attacker-controlled text going into a database and
 * then onto an HTML page in the admin panel; there is no reason to accept a
 * kilobyte of it.
 */
export function userAgent(req: Request): string {
  const raw = req.get('user-agent') ?? '';
  return raw.slice(0, 255);
}
