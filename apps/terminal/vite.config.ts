import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The @amplifi/* workspace packages are published as TypeScript source, so we
// exclude them from dependency pre-bundling and let Vite transform them inline.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ["@amplifi/quant-core", "@amplifi/strategy-core", "@amplifi/portfolio-opt"] },
  server: { port: 5173 },
});
