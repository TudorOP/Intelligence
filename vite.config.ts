import { defineConfig } from 'vite';
import { machineIdentity, inspectMachine } from './electron/system.mjs';
import { inspectContainers, readLogs } from './electron/workloads.mjs';
export default defineConfig({
  plugins: [
    {
      name: 'readonly-machine-preview',
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const endpoint = request.url?.split('?')[0];
          if (
            !['/api/machine', '/api/system', '/api/containers', '/api/logs'].includes(
              endpoint ?? '',
            )
          )
            return next();
          if (request.method !== 'GET') {
            response.statusCode = 405;
            return response.end('Read-only endpoint');
          }
          const origin = request.headers.origin;
          if (origin && origin !== `http://${request.headers.host}`) {
            response.statusCode = 403;
            return response.end('Same-origin requests only');
          }
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('X-Content-Type-Options', 'nosniff');
          try {
            response.end(
              JSON.stringify(
                endpoint === '/api/machine'
                  ? await machineIdentity()
                  : endpoint === '/api/containers'
                    ? await inspectContainers()
                    : endpoint === '/api/logs'
                      ? await readLogs(
                          Object.fromEntries(
                            new URL(request.url!, 'http://localhost').searchParams,
                          ),
                        )
                      : await inspectMachine(),
              ),
            );
          } catch (error) {
            response.statusCode = 500;
            response.end(JSON.stringify({ error: (error as Error).message }));
          }
        });
      },
    },
  ],
  base: './',
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/.test-data/**', '**/docs/screenshots/**', '**/Intelligence-source.zip'] } },
  build: { target: 'es2022' },
});
