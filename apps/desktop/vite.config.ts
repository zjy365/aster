import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rendererSource = fileURLToPath(new URL("./src/renderer", import.meta.url));
const rendererEntry = fileURLToPath(new URL("./index.html", import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": rendererSource,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: rendererEntry,
    },
  },
});
