// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    ignores: ["dist/","node_modules/"],
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "no-unused-expressions": "off",
      "@typescript-eslint/no-unused-expressions": "off"
    }
  }
);
