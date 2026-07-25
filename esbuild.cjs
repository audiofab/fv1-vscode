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

  // Build the standalone stdio MCP server (launched by VS Code's MCP host for Copilot,
  // and by Claude Code via .mcp.json). Pure Node/CJS, no `vscode` import — the MCP SDK,
  // zod, and fv1-core are all bundled in so the single .cjs is self-contained.
  const mcpServerCtx = await esbuild.context({
    entryPoints: ['src/mcp/server.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/mcp-server.cjs',
    external: ['node-hid', 'pkg-prebuilds'],  // native modules must be external (transitive-safe)
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
      mcpServerCtx.watch(),
      blockDiagramCtx.watch(),
      pedalSimCtx.watch()
    ]);
  } else {
    await Promise.all([
      extensionCtx.rebuild(),
      mcpServerCtx.rebuild(),
      blockDiagramCtx.rebuild(),
      pedalSimCtx.rebuild()
    ]);
    await Promise.all([
      extensionCtx.dispose(),
      mcpServerCtx.dispose(),
      blockDiagramCtx.dispose(),
      pedalSimCtx.dispose()
    ]);
  }

  // Copy static assets
  try {
    const wavSrc = path.join(__dirname, 'src/simulator/wav');
    const wavDest = path.join(__dirname, 'dist/simulator/wav');
    if (fs.existsSync(wavSrc)) {
      // Mirror src -> dist. Clear the destination first so clips removed from
      // src don't linger in dist (the runtime builds the simulator's clip list
      // by scanning this directory, and a stale file would otherwise reappear
      // in the dropdown and ship in the packaged .vsix).
      fs.rmSync(wavDest, { recursive: true, force: true });
      fs.mkdirSync(wavDest, { recursive: true });
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

  // Copy the ATL developer reference next to the MCP server bundle so its get_atl_reference tool
  // can read it at runtime. node_modules is excluded from the .vsix (see .vscodeignore), so the
  // doc must be copied into dist/, which ships.
  try {
    const corePkg = path.dirname(require.resolve('@audiofab-io/fv1-core/package.json'));
    fs.copyFileSync(
      path.join(corePkg, 'blocks/ATL_DEVELOPER_REFERENCE.md'),
      path.join(__dirname, 'dist/atl-reference.md'),
    );
    console.log('Copied ATL developer reference to dist/atl-reference.md');
  } catch (err) {
    console.warn('Failed to copy ATL reference:', err.message);
  }

  // Copy the curated example diagrams next to the MCP server bundle for its get_example tool.
  try {
    const exSrc = path.join(__dirname, 'src/mcp/examples');
    const exDest = path.join(__dirname, 'dist/mcp-examples');
    if (fs.existsSync(exSrc)) {
      fs.rmSync(exDest, { recursive: true, force: true });
      fs.mkdirSync(exDest, { recursive: true });
      fs.cpSync(exSrc, exDest, { recursive: true, force: true });
      console.log('Copied MCP example diagrams to dist/mcp-examples/');
    }
  } catch (err) {
    console.warn('Failed to copy MCP example diagrams:', err.message);
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
