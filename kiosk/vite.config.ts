import { defineConfig } from "vite";

export default defineConfig({
  // Publish only synthetic camera clips. Eval material and envelope sentinels
  // must never become visitor-accessible build artifacts.
  publicDir: "../fixtures/video",
  server: {
    proxy: {
      "/generate": "http://127.0.0.1:4173",
      "/content": "http://127.0.0.1:4173",
      "/config.json": "http://127.0.0.1:4173",
      "/config.example.json": "http://127.0.0.1:4173",
    },
  },
});
