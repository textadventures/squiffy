// @ts-check

import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import { includeIgnoreFile } from "@eslint/compat";
import { fileURLToPath } from "node:url";

const gitignorePath = fileURLToPath(new URL(".gitignore", import.meta.url));

export default defineConfig([
    {
        files: ["eslint.config.*"],
        languageOptions: {
            globals: {
                URL: "readonly",
            },
        },
    },
    includeIgnoreFile(gitignorePath, "Imported .gitignore patterns"),
    globalIgnores(["**/.astro/**", "examples/**"]),
    eslint.configs.recommended,
    tseslint.configs.recommended,
]);