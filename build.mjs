// Bundles the app with esbuild into dist/. Usage: node build.mjs [--watch]
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const base = process.env.BASE_PATH ?? './'; // relative paths work on GitHub Pages project sites and anywhere else
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const stamp = new Date().toISOString().slice(0, 16).replace(/\D/g, '');

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

const opts = {
  entryPoints: { app: 'src/main.tsx' },
  bundle: true,
  format: 'esm',
  target: ['es2022', 'safari15'],
  outdir: 'dist',
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch,
  define: { __PROD__: String(!watch), 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'), __VERSION__: JSON.stringify(version) },
  logLevel: 'info',
};

async function copyStatic() {
  await cp('public', 'dist', { recursive: true });
  const html = (await readFile('index.html', 'utf8')).replaceAll('%BASE%', base);
  await writeFile('dist/index.html', html);
  const sw = (await readFile('public/sw.js', 'utf8')).replace('__BUILD__', stamp);
  await writeFile('dist/sw.js', sw);
  await writeFile('dist/404.html', html); // GitHub Pages: unknown paths still open the app
}

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  await copyStatic();
  const { host, port } = await ctx.serve({ servedir: 'dist', port: 5173 });
  console.log(`dev server http://${host}:${port}`);
} else {
  await build(opts);
  await copyStatic();
}
