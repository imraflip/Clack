import { resolve } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { defineConfig } from 'vite';

const projectRoot = import.meta.dirname;
const clientRoot = resolve(projectRoot, 'src/client');
const apiModulePath = resolve(projectRoot, 'src/server/routes/api.ts');

type FetchHandler = (request: Request) => Response | Promise<Response>;

/** Loads the real Hono `/api` router through Vite SSR (in-memory Redis fallback, no Devvit context). */
async function loadApiFetch(server: ViteDevServer): Promise<FetchHandler | null> {
  const mod = await server.ssrLoadModule(apiModulePath);
  const api: unknown = Reflect.get(mod, 'api');
  if (typeof api !== 'object' || api === null) return null;
  const fetchFn: unknown = Reflect.get(api, 'fetch');
  if (typeof fetchFn !== 'function') return null;
  return (request) => Reflect.apply(fetchFn, api, [request]);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

/** Serves `/` as the expanded game (keeping `/splash.html` reachable) and mounts the local `/api`. */
function clackLocalPreview(): Plugin {
  return {
    name: 'clack-local-preview',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '/';
        if (url === '/' || url === '/index.html') {
          req.url = '/game.html';
          next();
          return;
        }
        if (!url.startsWith('/api/')) {
          next();
          return;
        }
        void (async () => {
          try {
            const handler = await loadApiFetch(server);
            if (!handler) {
              next();
              return;
            }
            const method = req.method ?? 'GET';
            const headers = new Headers();
            for (const [key, value] of Object.entries(req.headers)) {
              if (typeof value === 'string') headers.set(key, value);
            }
            const init: RequestInit = { method, headers };
            if (method !== 'GET' && method !== 'HEAD') {
              init.body = new Uint8Array(await readBody(req));
            }
            const response = await handler(
              new Request(`http://localhost${url.slice('/api'.length)}`, init)
            );
            res.statusCode = response.status;
            response.headers.forEach((value, key) => res.setHeader(key, value));
            res.end(Buffer.from(await response.arrayBuffer()));
          } catch (error) {
            next(error);
          }
        })();
      });
    },
  };
}

export const localConfig = defineConfig({
  root: clientRoot,
  publicDir: resolve(projectRoot, 'public'),
  plugins: [clackLocalPreview()],
  server: {
    port: 5173,
    strictPort: false,
    fs: {
      deny: [
        '.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}',
        '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.internal/**',
      ],
    },
  },
  build: {
    outDir: resolve(projectRoot, 'dist/local'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        game: resolve(clientRoot, 'game.html'),
        splash: resolve(clientRoot, 'splash.html'),
      },
    },
  },
});

export default localConfig;
