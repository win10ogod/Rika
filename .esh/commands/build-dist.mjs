import fs from 'node:fs'
import path from 'node:path'

import terser from 'npm:@rollup/plugin-terser'
import { exec } from 'npm:@steve02081504/exec'
import { rollup } from 'npm:rollup'
import { visualizer } from 'npm:rollup-plugin-visualizer'

fs.mkdirSync('dist', { recursive: true })

const charvar = await exec('git describe --tags --abbrev=0', { cwd: '.' }).then(result => result.stdout.trim())

const bundle = await rollup({
	input: './main.mjs',
	external: [
		/node:.*/,
		/npm:.*/,
		/https:\/\/.*/,
		/(?:.{2}\/){5}.*/
	],
	plugins: [
		{
			name: 'git-version-injector',
			renderChunk(code) {
				return {
					code: code
						.replace(/(const|let)\s*charvar = [^]*?\n\);?\n/, `const charvar = "${charvar}";`)
						.replace(/(const|let)\s*is_dist = [^\n]*\n/, 'const is_dist = true;'),
					map: null
				}
			}
		},
		terser({
			module: true,
			compress: {
				drop_console: ['log'],
				unsafe_arrows: true,
				unsafe: true,
				unsafe_Function: true,
				unsafe_math: true,
				unsafe_symbols: true,
				unsafe_methods: true,
				unsafe_proto: true,
				unsafe_regexp: true,
				unsafe_undefined: true,
				unused: true
			},
			mangle: false
		}),
		visualizer({ filename: 'dist/build_report.html', open: false })
	]
})

await bundle.write({ file: 'dist/main.mjs', inlineDynamicImports: true, format: 'esm' })
await bundle.close()

console.log('Build completed successfully and written to dist/main.mjs')

const copyPaths = [
	'info/description',
	'public',
	'locales',
	'skills',
	'config/display.html',
	'config/display.mjs',
	'ReadMe.md',
	'fount.json',
	'achievements_registry.json'
]
for (const source of copyPaths) {
	const destination = path.join('dist', source)
	if (fs.statSync(source).isDirectory())
		fs.cpSync(source, destination, { recursive: true })
	else {
		fs.mkdirSync(path.dirname(destination), { recursive: true })
		fs.copyFileSync(source, destination)
	}
}
