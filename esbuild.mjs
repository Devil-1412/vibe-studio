import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const shared = { bundle: true, sourcemap: !production, minify: production, logLevel: 'info' };

const configs = [
  { ...shared, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'] },
  { ...shared, entryPoints: ['webview/main.ts'], outfile: 'dist/webview.js', platform: 'browser', format: 'iife', target: 'es2022' },
  { ...shared, entryPoints: ['webview/style.css'], outfile: 'dist/webview.css' },
];
if (!production) {
  configs.push({ ...shared, entryPoints: ['scripts/check.ts'], outfile: 'dist/check.js', platform: 'node', format: 'cjs', target: 'node18' });
}

if (watch) {
  for (const c of configs) await (await esbuild.context(c)).watch();
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
}
