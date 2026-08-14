import { defineConfig, type Options } from "tsup";

const electronBundles = [
  {
    outputName: "main/index",
    source: "src/main/index.ts",
    format: "esm",
    extension: ".mjs",
  },
  {
    outputName: "preload/index",
    source: "src/preload/index.ts",
    format: "cjs",
    extension: ".cjs",
  },
] as const;

export default defineConfig(
  electronBundles.map((bundle): Options => ({
    entry: {
      [bundle.outputName]: bundle.source,
    },
    platform: "node",
    format: [bundle.format],
    external: ["electron"],
    outDir: "dist-electron",
    outExtension: () => ({ js: bundle.extension }),
    sourcemap: true,
    clean: false,
  })),
);
