import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  root: __dirname,
  publicDir: resolve(__dirname, '..'),
  server: {
    port: 5173,
    async configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method === 'POST' && (req.url === '/api/save-compositions' || req.url?.startsWith('/api/save-compositions'))) {
          let body = '';
          req.on('data', (chunk) => { body += chunk; });
          req.on('end', async () => {
            try {
              const targetPath = path.join(__dirname, 'src', 'animation-compositions.json');
              const backupPath = path.join(__dirname, 'src', 'animation-compositions.json.backup');
              if (fs.existsSync(targetPath)) {
                fs.copyFileSync(targetPath, backupPath);
              }
              fs.writeFileSync(targetPath, body, 'utf8');
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: String(e.message) }));
            }
          });
          return;
        }
        next();
      });
    },
  },
});
