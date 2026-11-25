
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5174,
    host: "0.0.0.0",
    allowedHosts: ["localhost", "127.0.0.1", "::1", "US-L-PF4X9MC1", "us-l-pf4x9mc1", "0.0.0.0", "[::1]"],
    proxy: {
      "/api": {
        target: `http://localhost:3001`,
        changeOrigin: true,
        secure: false,
        ws: true,
        proxyTimeout: 10000,
        timeout: 10000
      }
    }
  }
});
