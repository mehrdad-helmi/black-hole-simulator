// eslint.config.mjs
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import unusedImports from 'eslint-plugin-unused-imports';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
	{
		linterOptions: { reportUnusedDisableDirectives: 'error' },
		// ...ignores / other top-level settings
	},
	// Ignore build artifacts
	{
		ignores: ['dist', 'build', 'node_modules', 'coverage', '*.min.*'],
	},

	// TypeScript source files (browser)
	{
		files: ['**/*.ts'],
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: 'module',
			parser: tseslint.parser,
			parserOptions: {
				// Type-aware rules use your tsconfigs
				project: ['./tsconfig.json', './tsconfig.eslint.json'],
				tsconfigRootDir: import.meta.dirname,
			},
			// 👇 Add browser globals so `console`, `window`, etc. are defined
			globals: {
				...globals.browser,
				...globals.es2024,
			},
		},
		plugins: {
			'@typescript-eslint': tseslint.plugin,
			'import-x': importX,
			'unused-imports': unusedImports,
		},
		rules: {
			// Base + TS strict type-checked
			...js.configs.recommended.rules,
			...tseslint.configs.strictTypeChecked.rules,

			// In TS projects, disable no-undef (TS handles this + we set browser globals)
			'no-undef': 'off',

			// Allow console in browser app (you can flip to "warn" later)
			'no-console': 'off',

			// Some pragmatic TS strictness
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-explicit-any': ['warn', { fixToUnknown: false }],

			// Cleanup unused stuff
			'unused-imports/no-unused-imports': 'error',
			'unused-imports/no-unused-vars': [
				'warn',
				{ vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
			],

			// Import hygiene (import-x has great TS/ESM/bundler support)
			'import-x/order': [
				'warn',
				{
					'newlines-between': 'always',
					alphabetize: { order: 'asc', caseInsensitive: true },
					groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'object', 'type'],
				},
			],
			'import-x/newline-after-import': ['warn', { count: 1 }],
		},
	},

	// Config files can be noisy—relax them
	{
		files: ['**/*.{config,conf}.ts', 'vite.config.ts'],
		rules: {
			'no-console': 'off',
		},
	},

	// Let Prettier handle formatting conflicts
	eslintConfigPrettier,
);
