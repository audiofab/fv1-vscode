const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  // Build main extension
  const extensionCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.cjs',
    external: ['vscode', 'node-hid', 'pkg-prebuilds'],  // native modules must be external
    logLevel: 'warning',
    plugins: [esbuildProblemMatcherPlugin]
  });

  // Build block diagram editor webview
  const blockDiagramCtx = await esbuild.context({
    entryPoints: ['src/blockDiagram/editor/webview/index.tsx'],
    bundle: true,
    format: 'iife',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    target: 'es2020',
    outfile: 'dist/webview.js',
    jsx: 'automatic',
    jsxDev: !production,
    logLevel: 'warning',
    plugins: [esbuildProblemMatcherPlugin]
  });

  // Build spnbank editor webview
  const spnbankCtx = await esbuild.context({
    entryPoints: ['src/spnbank-webview/index.ts'],
    bundle: true,
    format: 'iife',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    target: 'es2020',
    outfile: 'dist/spnbank-webview.js',
    logLevel: 'warning',
    plugins: [esbuildProblemMatcherPlugin]
  });

  if (watch) {
    await Promise.all([
      extensionCtx.watch(),
      blockDiagramCtx.watch(),
      spnbankCtx.watch()
    ]);
  } else {
    await Promise.all([
      extensionCtx.rebuild(),
      blockDiagramCtx.rebuild(),
      spnbankCtx.rebuild()
    ]);
    await Promise.all([
      extensionCtx.dispose(),
      blockDiagramCtx.dispose(),
      spnbankCtx.dispose()
    ]);
  }
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd(result => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location == null) return;
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  }
};

main().catch(e => {
  console.error(e);
  process.exit(1);
});
