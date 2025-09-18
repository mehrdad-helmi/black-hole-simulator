// vite.config.ts
import { defineConfig } from 'vite';
import checker from 'vite-plugin-checker';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
	plugins: [
		glsl(),
		checker({
			typescript: { tsconfigPath: 'tsconfig.json' },
			eslint: {
				lintCommand: 'eslint --ext .ts src',
				useFlatConfig: true,
			},
			overlay: { initialIsOpen: false },
		}),
	],
});
