import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The scaffold under scaffold/ is a token-templated project, not valid TS until generated.
    exclude: ["node_modules", "dist", "scaffold/**"],
  },
});
