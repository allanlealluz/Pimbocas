import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    // Necessário para abrir o dev server via tunnel (Cloudflare/ngrok).
    allowedHosts: true,
  },
});
