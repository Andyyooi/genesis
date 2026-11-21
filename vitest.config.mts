import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "better-sqlite3": resolve(root, "tests/guarded-better-sqlite3.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
