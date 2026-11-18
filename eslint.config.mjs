// @ts-check

import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import { includeIgnoreFile } from "@eslint/compat";
import { fileURLToPath } from "node:url";

const gitignorePath = fileURLToPath(new URL(".gitignore", import.meta.url));

export default defineConfig([
    {
        rules: {
            quotes: ["error", "double", { avoidEscape: true }],
            "object-curly-spacing": ["error", "always"],
            "no-extra-semi": "error",
            "semi": ["error", "always"]
        },
    },
    {
        files: ["eslint.config.*"],
        languageOptions: {
            globals: {
                URL: "readonly",
            },
        },
    },
    {
        // The desktop app's build scripts run in Node
        files: ["desktop/scripts/**"],
        languageOptions: {
            globals: {
                URL: "readonly",
                console: "readonly",
                process: "readonly",
                require: "readonly",
                module: "writable",
            },
        },
    },
    includeIgnoreFile(gitignorePath, "Imported .gitignore patterns"),
    globalIgnores(["**/.astro/**", "**/.svelte-kit/**", "app/build/**", "examples/**", "compiler/test/fixtures/**"]),
    eslint.configs.recommended,
    tseslint.configs.recommended,
    {
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
        },
    },
    {
        // electron-builder loads its hooks as CommonJS
        files: ["**/*.cjs"],
        rules: {
            "@typescript-eslint/no-require-imports": "off",
        },
    },
]);