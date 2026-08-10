// Flat ESLint config. See .claude/rules/20-architecture-boundaries.md — the
// no-restricted-imports blocks below are the machine-enforced version of the
// dependency rule in docs/01-architecture.md section 4.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import next from "eslint-config-next";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      "src/generated/**",
      "templates/**/node_modules/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...next,
  ...nextCoreWebVitals,

  // ── type-aware linting ──
  // Rules like consistent-type-imports need the TypeScript program, not just the
  // AST. This is the whole reason the project stays on TypeScript 6 rather than 7
  // (ADR-011) — so actually use it. `projectService` picks up tsconfig.json
  // automatically and is faster than the legacy `project` option.
  {
    files: ["**/*.{ts,tsx,mts}"],
    languageOptions: {
      // Set the parser explicitly: eslint-config-next installs its own, which
      // does not forward projectService to @typescript-eslint/parser, so the
      // type-aware rules would fail to find the TypeScript program.
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Plain JS (this config file, postcss.config.mjs) is not in the TS program,
  // so type-aware rules must be switched off for it or they crash.
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },

  // ── house rules (docs/01 section 4, .claude/rules/10-typescript.md) ──
  {
    files: ["**/*.{ts,tsx,mts}"],
    rules: {
      // jsx-a11y is registered and enabled by eslint-config-next/core-web-vitals.
      // These three are not on by default there, and matter for this project
      // (.claude/rules/60-ui-and-accessibility.md).
      "jsx-a11y/label-has-associated-control": "error",
      "jsx-a11y/no-autofocus": "warn",
      "jsx-a11y/anchor-ambiguous-text": "warn",

      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },

  // ── BOUNDARY: app/ must never touch Prisma directly ──
  // Data access belongs in src/server/repositories/. See docs/01 section 4.
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@prisma/client", "@prisma/client/*", "**/server/db"],
              message:
                "app/ must not import Prisma directly. Go through a repository in src/server/repositories/ (docs/01 section 4).",
            },
            {
              group: ["**/repositories/*"],
              message:
                "app/ must not import repositories directly. Call a service in src/server/services/ (docs/01 section 4).",
            },
          ],
        },
      ],
    },
  },

  // ── BOUNDARY: services must stay framework-agnostic ──
  // This is the seam that keeps services unit-testable without a Next runtime
  // and extractable into a separate process later. See docs/01 section 9.
  {
    files: ["src/server/services/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "react", "react-dom", "server-only"],
              message:
                "server/services/ must not import next/* or react. This is the extractable seam (docs/01 section 9).",
            },
            {
              // @/server/db is banned too, not just @prisma/client: it exports
              // the PrismaClient instance, so importing it would let a service
              // run queries and bypass the repository layer entirely.
              group: ["@prisma/client", "@prisma/client/*", "**/server/db", "@/server/db"],
              message:
                "Services reach the database through a repository, never the Prisma client (docs/01 section 4).",
            },
          ],
        },
      ],
    },
  },

  // ── BOUNDARY: domain/ imports nothing from this project ──
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/server/*",
                "@/app/*",
                "@/components/*",
                "@/lib/*",
                "next",
                "next/*",
              ],
              message:
                "domain/ is dependency-free: Zod schemas, types, and errors only (docs/01 section 4).",
            },
          ],
        },
      ],
    },
  },

  // ── BOUNDARY: UI never reaches into the server layer ──
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/*"],
              message:
                "Components receive data as props. Fetch in a Server Component under src/app/ (docs/01 section 4).",
            },
          ],
        },
      ],
    },
  },

  // ── scripts, tests, and config are exempt from the app rules ──
  {
    files: [
      "scripts/**/*.{ts,mts}",
      "tests/**/*.ts",
      "prisma/**/*.ts",
      "*.config.{ts,mts,mjs}",
    ],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "no-restricted-imports": "off",
    },
  },
);
