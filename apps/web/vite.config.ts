import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Worker (packages/infra, `bun run dev`) owns these paths; in production it serves this app too, same origin.
const server = process.env.SONA_SERVER_URL ?? "http://localhost:3000";
const proxied = ["/rpc", "/api/auth", "/live", "/agents", "/lab", "/insurer"];
// Sign-in only trusts the Worker's CORS_ORIGIN. A second dev server on another port (a worktree's) sets
// SONA_PROXY_ORIGIN to that origin so its requests are trusted too.
const headers = process.env.SONA_PROXY_ORIGIN ? { origin: process.env.SONA_PROXY_ORIGIN } : undefined;

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  server: { proxy: Object.fromEntries(proxied.map(path => [path, { target: server, ws: true, changeOrigin: true, headers }])) },
});
