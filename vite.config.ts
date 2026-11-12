import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Serve the Netlify functions (/api/* and /mcp) inside the Vite dev server, so local
 * development is one fast process (`npm run dev`). On Netlify the same file runs
 * as a real Function. `npm run dev:netlify` uses the full Netlify CLI instead.
 */
function localApi(): Plugin {
  return {
    name: "hesed-local-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const file = req.url?.startsWith("/api/") ? "api" : req.url?.split("?")[0] === "/mcp" ? "mcp" : null;
        if (!file) return next();
        try {
          const mod = await server.ssrLoadModule(`/netlify/functions/${file}.ts`);
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const request = new Request(`http://${req.headers.host}${req.url}`, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
          });
          const response: Response = await mod.default(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApi()],
  // Never open a second copy on another port: two copies on one database folder would clash.
  server: { port: 5173, strictPort: true },
  ssr: { external: ["@electric-sql/pglite"] },
  test: { environment: "node" },
} as never);
