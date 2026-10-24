import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  base: './',
  server: {
    port: 3000,
    open: false
  },
  build: {
    outDir: 'dist',
    target: 'esnext'
  },
  plugins: [
    {
      name: 'serve-and-copy-project-json',
      configureServer(server) {
        server.middlewares.use('/__repo_project_json', (req, res, next) => {
          try {
            const p = path.resolve(process.cwd(), 'project.json');
            if (fs.existsSync(p)) {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
              res.end(fs.readFileSync(p, 'utf-8'));
              return;
            }
          } catch (e) {
            // fallback
          }
          next();
        });
      },
      closeBundle() {
        try {
          const src = path.resolve(process.cwd(), 'project.json');
          const destDir = path.resolve(process.cwd(), 'dist');
          if (fs.existsSync(src) && fs.existsSync(destDir)) {
            fs.copyFileSync(src, path.join(destDir, 'project.json'));
          }
        } catch (e) {
          // ignore
        }
      }
    }
  ]
});
