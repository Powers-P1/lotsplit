import express from 'express';
import { config, parse } from 'dotenv';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import { createApiRouter } from './routes.js';
import { LotSplitEngine, type DomainState } from './domain.js';
import { SqliteStore } from './store.js';
import { createAiProvider } from './ai.js';
import { createPayPalProvider } from './paypal.js';

config({ path: resolve('.env.local'), quiet: true });
config({ path: resolve('.env'), quiet: true });
if (process.env.NEBIUS_ENV_FILE) {
  const privatePath = resolve(process.env.NEBIUS_ENV_FILE);
  if (existsSync(privatePath)) {
    const values = parse(readFileSync(privatePath));
    for (const [name, value] of Object.entries(values))
      if (name.startsWith('NEBIUS_') && !process.env[name]) process.env[name] = value;
  }
}
if (process.env.APP_MODE && !['rehearsal', 'sandbox'].includes(process.env.APP_MODE))
  throw new Error('APP_MODE must be rehearsal or sandbox.');
const mode = process.env.APP_MODE === 'sandbox' ? 'sandbox' : 'rehearsal';
const port = Number(process.env.PORT || 4319);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
const host = process.env.HOST || '127.0.0.1';
const origin = process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${port}`;
const judgeUsername = process.env.JUDGE_ACCESS_USERNAME || '';
const judgePassword = process.env.JUDGE_ACCESS_PASSWORD || '';
if (Boolean(judgeUsername) !== Boolean(judgePassword) || judgeUsername.includes(':') ||
  (judgeUsername && (!judgeUsername.trim() || !judgePassword.trim())))
  throw new Error('Set both JUDGE_ACCESS_USERNAME and JUDGE_ACCESS_PASSWORD to enable private judging access. The username cannot contain a colon.');
const privateJudging = Boolean(judgeUsername);
const expectedJudgeCredentials = createHash('sha256').update(`${judgeUsername}:${judgePassword}`).digest();
const aiDailyRequestLimit = Number(process.env.AI_DAILY_REQUEST_LIMIT || 100);
if (!Number.isSafeInteger(aiDailyRequestLimit) || aiDailyRequestLimit < 1)
  throw new Error('AI_DAILY_REQUEST_LIMIT must be a positive integer.');
const sessionCookieName = process.env.SESSION_COOKIE_NAME || 'lotsplit_session';
const dataDirectory = resolve(process.env.DATA_DIR || './data');
mkdirSync(dataDirectory, { recursive: true });
const store = new SqliteStore<DomainState>(join(dataDirectory, `lotsplit-${mode}.sqlite`));
const ai = createAiProvider();
const paypal = createPayPalProvider();
const engine = new LotSplitEngine(store, {
  mode, baseUrl: origin, aiConfigured: ai.configured,
  paymentProvider: mode === 'sandbox' && paypal.configured ? paypal : undefined,
});
let organizerAccessToken = process.env.ORGANIZER_ACCESS_TOKEN;
if (mode === 'sandbox' && !organizerAccessToken) {
  const bootstrapFile = join(dataDirectory, 'organizer-access.json');
  if (existsSync(bootstrapFile)) {
    const bootstrap = JSON.parse(readFileSync(bootstrapFile, 'utf8')) as { organizerAccessToken?: string };
    organizerAccessToken = bootstrap.organizerAccessToken;
  }
  if (!organizerAccessToken) {
    organizerAccessToken = randomBytes(32).toString('base64url');
    writeFileSync(bootstrapFile, JSON.stringify({ organizerAccessToken }, null, 2), { mode: 0o600, flag: 'wx' });
  }
}
const app = express();
app.disable('x-powered-by');
if (process.env.RENDER_EXTERNAL_URL) app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use((req, res, next) => {
  if (!privateJudging || (req.path === '/api/health' && ['GET', 'HEAD'].includes(req.method))) return next();
  const authorization = req.headers.authorization;
  const match = authorization && /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
  if (match && timingSafeEqual(createHash('sha256').update(Buffer.from(match[1], 'base64')).digest(), expectedJudgeCredentials)) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="LOTSPLIT judging", charset="UTF-8"');
  res.setHeader('Cache-Control', 'no-store');
  res.status(401).json({ code: 'JUDGE_ACCESS_REQUIRED', error: 'Use the private judging credentials supplied with the submission.' });
});
app.use(express.json({ limit: '12mb' }));
app.get('/api/health', (_req, res) => res.json(privateJudging ? { ok: true } : {
  ok: true, application: 'LOTSPLIT', mode,
  providers: { ai: ai.configured, paypalSandbox: mode === 'sandbox' && paypal.configured },
}));
store.db.exec('CREATE TABLE IF NOT EXISTS ai_request_limits (window_key TEXT PRIMARY KEY, count INTEGER NOT NULL)');
app.use('/api/ai', (req, res, next) => {
  if (req.method !== 'POST' || !ai.configured) return next();
  // Rejected, unauthenticated requests must not consume the shared judging allowance.
  const sessionToken = req.headers.cookie?.split(';').map(value => value.trim())
    .find(value => value.startsWith(`${sessionCookieName}=`))?.slice(sessionCookieName.length + 1);
  if (!sessionToken || !/^[A-Za-z0-9_-]{20,100}$/.test(sessionToken) || !store.sessionUser(sessionToken)) return next();
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const minute = Math.floor(now.getTime() / 60000);
  const keys = [
    { key: `day:${day}`, limit: aiDailyRequestLimit },
    { key: `minute:${req.ip || 'local'}:${minute}`, limit: 6 },
  ];
  store.db.exec('BEGIN IMMEDIATE');
  try {
    for (const entry of keys) {
      const record = store.db.prepare('SELECT count FROM ai_request_limits WHERE window_key=?').get(entry.key) as { count: number } | undefined;
      if ((record?.count || 0) >= entry.limit) {
        store.db.exec('ROLLBACK');
        res.status(429).json({ code: 'AI_RATE_LIMIT', error: 'The AI request limit has been reached. Try later or choose items manually.' });
        return;
      }
    }
    for (const entry of keys)
      store.db.prepare('INSERT INTO ai_request_limits(window_key,count) VALUES (?,1) ON CONFLICT(window_key) DO UPDATE SET count=count+1').run(entry.key);
    store.db.exec('COMMIT');
    next();
  } catch (error) { store.db.exec('ROLLBACK'); next(error); }
});
app.use('/api', createApiRouter(engine, {
  aiProvider: ai.configured ? ai : undefined, origin, organizerAccessToken, sessionCookieName,
}));
app.use('/api', (_req, res) => res.status(404).json({ code: 'NOT_FOUND', error: 'This operation was not found.' }));

let vite: Awaited<ReturnType<typeof import('vite')['createServer']>> | undefined;
if (process.env.NODE_ENV === 'production') {
  const clientDirectory = resolve('dist/client');
  app.use(express.static(clientDirectory, { index: false }));
  app.get('/{*path}', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(join(clientDirectory, 'index.html'));
  });
} else {
  const { createServer } = await import('vite');
  vite = await createServer({ server: { middlewareMode: true, ws: { port: Number(process.env.HMR_PORT || (port < 55000 ? port + 10000 : port - 10000)) } }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.use(((error, _req, res, _next) => {
  const status = (error as { status?: number }).status;
  res.status(status && status >= 400 && status < 500 ? status : 500).json({
    code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'REQUEST_ERROR',
    error: status === 413 ? 'The photo is too large. Choose a file up to 8 MB.' : 'The request could not be processed.',
  });
}) as express.ErrorRequestHandler);
const server: Server = app.listen(port, host, () => {
  console.log(`LOTSPLIT: ${origin} (${mode}; AI ${ai.configured ? 'Nebius' : 'not configured'}; PayPal ${mode === 'sandbox' && paypal.configured ? 'sandbox configured' : 'simulated payments'})`);
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close(async () => { await vite?.close(); store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

