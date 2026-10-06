import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Worker (packages/infra, `bun run dev`) owns these paths; in production it serves this app too, same origin.
const server = process.env.SONA_SERVER_URL ?? "http://localhost:3000";
const proxied = ["/rpc", "/api/auth", "/live", "/agents", "/lab", "/insurer"];

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  server: { proxy: Object.fromEntries(proxied.map(path => [path, { target: server, ws: true, changeOrigin: true }])) },
});
