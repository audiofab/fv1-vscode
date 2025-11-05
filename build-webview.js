/**
 * Build script for webview React application
 * Uses esbuild to bundle React + TypeScript for the webview
 */

import esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
    // Build block diagram editor webview
    const blockDiagramCtx = await esbuild.context({
        entryPoints: ['src/blockDiagram/editor/webview/index.tsx'],
        bundle: true,
        format: 'iife',
        outfile: 'out/webview.js',
        platform: 'browser',
        target: 'es2020',
        sourcemap: !production,
        minify: production,
        loader: {
            '.tsx': 'tsx',
            '.ts': 'ts',
        },
        define: {
            'process.env.NODE_ENV': production ? '"production"' : '"development"',
        },
        jsx: 'automatic',
        jsxDev: !production,
        external: [],
        logLevel: 'info',
    });

    // Build spnbank editor webview
    const spnbankCtx = await esbuild.context({
        entryPoints: ['src/spnbank-webview/index.ts'],
        bundle: true,
        format: 'iife',
        outfile: 'out/spnbank-webview.js',
        platform: 'browser',
        target: 'es2020',
        sourcemap: !production,
        minify: production,
        loader: {
            '.ts': 'ts',
        },
        define: {
            'process.env.NODE_ENV': production ? '"production"' : '"development"',
        },
        external: [],
        logLevel: 'info',
    });

    if (watch) {
        await Promise.all([blockDiagramCtx.watch(), spnbankCtx.watch()]);
        console.log('Watching for changes...');
    } else {
        await Promise.all([blockDiagramCtx.rebuild(), spnbankCtx.rebuild()]);
        await Promise.all([blockDiagramCtx.dispose(), spnbankCtx.dispose()]);
        console.log('Build complete!');
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
