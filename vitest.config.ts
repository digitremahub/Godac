import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Les fichiers .tsx testés (PDF react-pdf) utilisent la même transformation JSX automatique que Next.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    // Copies de travail des agents : jamais testées depuis la racine.
    exclude: [...configDefaults.exclude, ".claude/worktrees/**"],
  },
});
