import { getConfiguration } from "@localdot/config/eslint";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "vite.config.ts",
      "tailwind.config.ts",
      "postcss.config.cjs",
      "playwright.config.ts",
      // Build-time product manifest, loaded by polkadot-app-deploy via jiti and
      // excluded from tsconfig — not app source, so keep it out of type-aware lint
      // (same treatment as the other *.config.ts above).
      "polkadot-app-deploy.config.ts",
      "**/*.test.ts",
      "**/*.test.tsx",
      "e2e/**",
    ],
  },
  ...getConfiguration({
    typescript: { rootDir: __dirname },
    browser: true,
  }),
];
