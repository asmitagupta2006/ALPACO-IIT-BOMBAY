import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createAlpacaRouter } from './server/routes/alpaca.ts';
import { createDeltaRouter } from './server/routes/delta.ts';
import { createSentinelRouter } from './server/routes/sentinel.ts';
import { ensureSentinelInitialized } from './server/sentinelEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer(): Promise<void> {
  const app = express();
  const port = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '1mb' }));

  // Public read-only Delta Exchange India proxy routes
  app.use('/api', createDeltaRouter());
  // Optional read-only Alpaca Market Data proxy routes
  app.use('/api/alpaca', createAlpacaRouter());
  // Regime Sentinel ML, safety guardrails, paper trading & audit API
  app.use('/api/sentinel', createSentinelRouter());

  // Warm up SQLite & baseline ML models in background without blocking port binding
  void ensureSentinelInitialized().catch((err) => {
    console.warn('[RegimeSentinel] Background model bootstrap warning:', err instanceof Error ? err.message : err);
  });

  if (isProd) {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });

    app.use(vite.middlewares);

    app.get('*', async (req, res, next) => {
      try {
        const indexPath = path.resolve(__dirname, 'index.html');
        const template = fs.readFileSync(indexPath, 'utf-8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (err) {
        next(err);
      }
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`[RegimeSentinel] Server listening on http://0.0.0.0:${port} (mode=${isProd ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('[RegimeSentinel] Fatal server startup error:', err);
  process.exit(1);
});
