import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/contracts/exportJsonSchemas.ts",
        "src/contracts/checkJsonSchemas.ts",
        // Fichier généré, contenu purement déclaratif.
        "src/registry.fields.generated.ts",
      ],
      thresholds: {
        lines: 75,
        statements: 75,
        functions: 70,
        branches: 70,
      },
    },
  },
});
