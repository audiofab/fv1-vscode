const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

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
    logOverride: {
      'empty-import-meta': 'silent'
    },
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

  // Build pedal simulator webview (the new pedal-shaped, real-time simulator)
  const pedalSimCtx = await esbuild.context({
    entryPoints: ['src/simulator/PedalSimulator/webview/index.tsx'],
    bundle: true,
    format: 'iife',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    target: 'es2020',
    outfile: 'dist/PedalSimulator.js',
    jsx: 'automatic',
    jsxDev: !production,
    logLevel: 'warning',
    plugins: [esbuildProblemMatcherPlugin]
  });

  if (watch) {
    await Promise.all([
      extensionCtx.watch(),
      blockDiagramCtx.watch(),
      pedalSimCtx.watch()
    ]);
  } else {
    await Promise.all([
      extensionCtx.rebuild(),
      blockDiagramCtx.rebuild(),
      pedalSimCtx.rebuild()
    ]);
    await Promise.all([
      extensionCtx.dispose(),
      blockDiagramCtx.dispose(),
      pedalSimCtx.dispose()
    ]);
  }

  // Copy static assets
  try {
    const wavSrc = path.join(__dirname, 'src/simulator/wav');
    const wavDest = path.join(__dirname, 'dist/simulator/wav');
    if (fs.existsSync(wavSrc)) {
      if (!fs.existsSync(path.dirname(wavDest))) fs.mkdirSync(path.dirname(wavDest), { recursive: true });
      fs.cpSync(wavSrc, wavDest, { recursive: true, force: true });
      console.log('Copied simulator WAV assets to dist/');
    }
  } catch (err) {
    console.warn('Failed to copy WAV assets:', err.message);
  }

  // Copy easy-spin-ui assets into dist/ so the pedal-simulator webview can
  // load the precompiled stylesheet, the audio worklet, and the pedal image
  // via webview.asWebviewUri(). Worklets in particular cannot be bundled
  // into the webview JS — they need to live at a fetchable URL.
  try {
    const uiPkg = path.dirname(require.resolve('@audiofab-io/easy-spin-ui/package.json'));
    const uiDest = path.join(__dirname, 'dist/easy-spin-ui');
    fs.mkdirSync(uiDest, { recursive: true });
    fs.copyFileSync(path.join(uiPkg, 'dist/styles.css'), path.join(uiDest, 'styles.css'));
    fs.mkdirSync(path.join(uiDest, 'worklet'), { recursive: true });
    fs.copyFileSync(
      path.join(uiPkg, 'dist/worklet/fv1-processor.js'),
      path.join(uiDest, 'worklet/fv1-processor.js'),
    );
    fs.mkdirSync(path.join(uiDest, 'assets'), { recursive: true });
    fs.copyFileSync(
      path.join(uiPkg, 'dist/assets/pedal.png'),
      path.join(uiDest, 'assets/pedal.png'),
    );
    console.log('Copied easy-spin-ui assets to dist/easy-spin-ui/');
  } catch (err) {
    console.warn('Failed to copy easy-spin-ui assets:', err.message);
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
