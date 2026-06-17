/**
 * PM2 ecosystem for the Ratio backend.
 *
 * Usage (from repo root):
 *
 *   # one-time setup
 *   npm i -g pm2                                  # install PM2 globally
 *   pnpm install --frozen-lockfile                # install workspace deps
 *   pnpm --filter @ratio-app/shared build         # compile the shared package
 *   pnpm --filter @ratio-app/backend build        # nest build → apps/backend/dist
 *   NODE_ENV=production pnpm migrate              # apply migrations on prod DBs
 *
 *   # boot
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 save                                      # persist process list
 *   pm2 startup                                   # generate boot-time autostart (run shown command as root)
 *
 *   # lifecycle
 *   pm2 reload  ratio-backend-analytics           # zero-downtime reload (cluster only)
 *   pm2 restart ratio-backend-analytics           # restart (fork mode)
 *   pm2 logs    ratio-backend-analytics           # tail
 *   pm2 stop    ratio-backend-analytics
 *   pm2 delete  ratio-backend-analytics
 *
 * Notes:
 *   - `cwd: __dirname` makes process.cwd() = repo root. main.ts's
 *     dotenv path is `.env.production` relative to cwd, so the file
 *     resolves to `<repo>/.env.production`. ConfigModule's
 *     envFilePath fallback `['../../.env.production']` also works
 *     from `apps/backend/`.
 *   - Single instance ('fork' mode) is the default. To scale: set
 *     `instances: 'max'` + `exec_mode: 'cluster'`, but raise
 *     `DB_POOL_SIZE` / MySQL `max_connections` accordingly (formula:
 *     instances × modules × pool ≤ max_connections × 0.6).
 *   - The backend serves every vendor module's API under subpath routing on
 *     the same port. It serves NO static UI (SERVE_STATIC=false) — the admin
 *     SPA is built and deployed by a separate service.
 */
module.exports = {
  apps: [
    {
      name: 'ratio-apps-backend',
      script: 'apps/backend/dist/apps/backend/src/main.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        // API-only: the backend serves no static UI. The admin SPA is built and
        // deployed by a separate service, so static serving stays off.
        SERVE_STATIC: 'false',
      },
      // PM2 will restart if the process exits non-zero. These limits guard
      // against pathological loops (e.g., DB unavailable → crash on boot).
      autorestart: true,
      max_restarts: 5,
      min_uptime: '10s',
      restart_delay: 4000,
      // Hard memory ceiling — restart the worker if it exceeds. Tune for your
      // VM size; 500MB is generous for this workload.
      max_memory_restart: '500M',
      // Listen for SIGTERM (NestJS's enableShutdownHooks + Fastify graceful
      // shutdown). Default kill timeout is 1.6s; bump so in-flight requests
      // finish cleanly under SIGTERM.
      kill_timeout: 8000,
      // Log paths (relative to cwd). Rotate via `pm2 install pm2-logrotate`.
      error_file: 'logs/ratio-apps-backend.error.log',
      out_file: 'logs/ratio-apps-backend.out.log',
      merge_logs: true,
      time: true,
      // pino already emits structured JSON in prod (no pino-pretty in
      // production per app.module.ts). PM2 just captures stdout/stderr.
    },
  ],
};
