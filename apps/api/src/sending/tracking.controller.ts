import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { TrackingService } from './tracking.service';

// 43-byte 1x1 transparent GIF served for every open-pixel hit.
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public (unauthenticated) tracking + unsubscribe surface hit directly by mail
// clients. Paths must match the URLs baked into outbound mail by send-render.ts:
//   /t/o/:trackingId          open pixel
//   /t/c/:trackingId?u=<url>  click redirect
//   /u/:token                 unsubscribe (GET landing, POST performs)
// Recording never blocks the response — a mangled token still yields the pixel /
// redirect / page, it just isn't logged.
@Controller()
@Public()
export class TrackingController {
  constructor(
    private readonly tracking: TrackingService,
    private readonly config: ConfigService,
  ) {}

  private fallbackUrl(): string {
    return this.config.get<string>('WEB_URL', 'http://localhost:3000');
  }

  // Only http(s) targets are honored — blocks javascript:/data: open-redirects.
  private safeUrl(u: string | undefined): string | null {
    if (!u) return null;
    try {
      const parsed = new URL(u);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
        ? parsed.toString()
        : null;
    } catch {
      return null;
    }
  }

  @Get('t/o/:trackingId')
  async open(
    @Param('trackingId') trackingId: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (UUID_RE.test(trackingId)) {
      try {
        await this.tracking.recordOpen(trackingId, userAgent);
      } catch {
        /* never fail an open pixel */
      }
    }
    res.set({
      'Content-Type': 'image/gif',
      'Content-Length': String(PIXEL.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.end(PIXEL);
  }

  @Get('t/c/:trackingId')
  async click(
    @Param('trackingId') trackingId: string,
    @Query('u') u: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const target = this.safeUrl(u);
    if (target && UUID_RE.test(trackingId)) {
      try {
        await this.tracking.recordClick(trackingId, target, userAgent);
      } catch {
        /* redirect regardless of logging outcome */
      }
    }
    res.redirect(302, target ?? this.fallbackUrl());
  }

  // Landing page: a GET has no side effects (mail scanners prefetch links, and a
  // prefetch must not unsubscribe anyone). The button POSTs to confirm.
  @Get('u/:token')
  landing(@Param('token') token: string, @Res() res: Response): void {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(this.landingHtml(token));
  }

  // Performs the unsubscribe. Serves both the confirm button and RFC 8058
  // one-click (Gmail/Outlook POST `List-Unsubscribe=One-Click` here).
  @Post('u/:token')
  @HttpCode(200)
  async unsubscribe(
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    let ok = false;
    if (UUID_RE.test(token)) {
      try {
        ok = (await this.tracking.unsubscribe(token)).ok;
      } catch {
        ok = false;
      }
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(this.resultHtml(ok));
  }

  private page(body: string): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribe</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
background:#f6f7f9;color:#1f2733;margin:0;display:flex;min-height:100vh;
align-items:center;justify-content:center}.card{background:#fff;border:1px solid #e5e8ec;
border-radius:12px;padding:32px 40px;max-width:420px;text-align:center;
box-shadow:0 1px 3px rgba(0,0,0,.06)}h1{font-size:20px;margin:0 0 8px}
p{color:#5b6675;font-size:14px;line-height:1.5;margin:0 0 20px}
button{background:#2f6df6;color:#fff;border:0;border-radius:8px;padding:10px 20px;
font-size:14px;font-weight:600;cursor:pointer}button:hover{background:#255ad6}</style>
</head><body><div class="card">${body}</div></body></html>`;
  }

  private landingHtml(token: string): string {
    const safe = UUID_RE.test(token) ? token : '';
    return this.page(
      `<h1>Unsubscribe</h1>
<p>Click below to stop receiving these emails. You won't be contacted again.</p>
<form method="post" action="/u/${safe}"><button type="submit">Unsubscribe me</button></form>`,
    );
  }

  private resultHtml(ok: boolean): string {
    return ok
      ? this.page(
          `<h1>You're unsubscribed</h1><p>You've been removed and won't receive further emails. You can close this tab.</p>`,
        )
      : this.page(
          `<h1>Link expired</h1><p>We couldn't process this request. The link may be invalid or already used.</p>`,
        );
  }
}
