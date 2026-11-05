import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // "server-only" rebenta fora do Next de propósito; nos testes usamos um vazio.
      "server-only": path.resolve(__dirname, "tests/vazio.ts"),
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
