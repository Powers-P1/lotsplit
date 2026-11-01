import type { Express } from 'express';
import express from 'express';
import { resolve } from 'node:path';

/** Public presentation files contain no runtime state, credentials or invitations. */
export function mountPublicSite(app: Express) {
  const directory = resolve(process.env.NODE_ENV === 'production' ? 'dist/client/site' : 'public/site');
  const policy = [
    "default-src 'self'", "script-src 'self'", "style-src 'self'",
    "img-src 'self'", "font-src 'self'", "connect-src 'self'",
    'frame-src https://www.youtube-nocookie.com',
    "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join('; ');
  for (const [route, file] of [['/about', 'index.html'], ['/privacy', 'privacy.html'], ['/judges', 'judges.html']]) {
    app.get(route, (_req, res, next) => {
      res.setHeader('Content-Security-Policy', policy);
      // YouTube embeds require a Referer; these public pages contain no private
      // state. Cross-origin requests disclose only the public origin.
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Cache-Control', 'public, max-age=300');
      if (route === '/judges') res.setHeader('X-Robots-Tag', 'noindex, follow');
      res.sendFile(resolve(directory, file), error => { if (error) next(error); });
    });
  }
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send('User-agent: *\nAllow: /about\nAllow: /privacy\nAllow: /site/\nDisallow: /\nSitemap: https://lotsplit.onrender.com/sitemap.xml\n');
  });
  app.get('/sitemap.xml', (_req, res) => {
    res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://lotsplit.onrender.com/about</loc></url></urlset>');
  });
  app.use('/site', express.static(directory, { index: false, dotfiles: 'deny', fallthrough: false, maxAge: '1h' }));
}
