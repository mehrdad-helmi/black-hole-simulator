// vite.config.ts
import { defineConfig } from 'vite';
import checker from 'vite-plugin-checker';

export default defineConfig({
	plugins: [
		checker({
			typescript: { tsconfigPath: 'tsconfig.json' },
			eslint: {
				// Windows/PowerShell-safe; no quoted globs
				lintCommand: 'eslint --ext .ts src',
				// ESLint v9 + flat config
				useFlatConfig: true,
			},
			overlay: { initialIsOpen: false },
		}),
	],
});
