# fv1-vscode — Working Notes for Claude

VS Code extension providing FV-1 development + Audiofab Easy Spin pedal programming.
The DSP core (assembler, simulator, block compiler, ATL block library) lives in
`@audiofab-io/fv1-core` — for anything about ATL blocks or FV-1 codegen, see that package's
`CLAUDE.md` and `blocks/ATL_DEVELOPER_REFERENCE.md`. This file is about the *extension*.

## Build system (esbuild, three bundles)

`esbuild.cjs` builds **four** independent bundles — the extension host and the MCP server are
Node/CJS, the webviews are browser/IIFE:

| entry | output | platform/format |
|---|---|---|
| `src/extension.ts` | `dist/extension.cjs` | node / cjs |
| `src/mcp/server.ts` | `dist/mcp-server.cjs` | node / cjs (standalone, no `vscode`) |
| `src/blockDiagram/editor/webview/index.tsx` | `dist/webview.js` | browser / iife (React) |
| `src/simulator/PedalSimulator/webview/index.tsx` | `dist/PedalSimulator.js` | browser / iife (React) |

- `node esbuild.cjs` = dev build (sourcemaps, unminified). `--production` minifies.
  `npm run package` runs `check-types` then a production build.
- `npm run watch` runs all bundles in watch mode; use it while debugging (F5).
- `native modules` (`node-hid`, `pkg-prebuilds`) and `vscode` are marked **external** — never
  bundled. That's why a `node-hid` version bump doesn't touch the JS bundles.
- The build also copies static assets into `dist/`: simulator WAV clips, and the
  `@audiofab-io/easy-spin-ui` stylesheet / audio worklet / pedal image (worklets can't be
  bundled — they need a fetchable URL via `webview.asWebviewUri`).

After changing webview code you must rebuild the bundle **and reload the Extension Dev Host**
(`Ctrl+R` in that window, or restart F5) — the running webview holds the old JS.

## Webviews are React — the #1 failure mode

Both the block-diagram editor and the pedal simulator are React (+ react-konva) webviews. If
one renders as a **blank white screen**, and especially if *both* break together, suspect a
**`react` / `react-dom` version mismatch**: React throws "Incompatible React versions" at
webview init if the two packages aren't the exact same version, and it crashes the whole tree.
Fix = pin both to the same version, `npm install`, rebuild bundles, reload. Dependabot bumps
them in separate PRs, so a `react` group in `.github/dependabot.yml` keeps them in lockstep
(react, react-dom, @types/react, @types/react-dom). `react-konva` tracks React's major but is
fine a patch behind, so keep it out of that group.

## CI / publishing

- `.github/workflows/main.yaml`: matrix build (Node 22) + package via `@vscode/vsce package`
  (no PAT needed — packaging isn't authenticated; only `vsce publish` is). The publish job uses
  Azure workload-identity federation (OIDC), not a stored PAT.
- Trigger a dry run with `workflow_dispatch` (`publish: false`) to exercise packaging across
  all three OSes before a real release.
- GitHub Actions Node-20-runtime deprecation warnings → bump the action major (`@v5`). Some
  third-party actions may still target Node 20; GitHub force-runs them on Node 24 harmlessly.

## MCP server (AI patch building)

`dist/mcp-server.cjs` is a **standalone stdio MCP server** ([src/mcp/server.ts](src/mcp/server.ts))
that exposes the block catalog + graph compiler to AI agents so they can author `.spndiagram`
patches. It has **no `vscode` import** — the MCP SDK, zod, and `@audiofab-io/fv1-core` are all
bundled in, so the one `.cjs` is launchable by any MCP client. It rebuilds the registry from
`BUILTIN_BLOCKS` (+ `--custom-block-path <dir>` args) and news up a `GraphCompiler`, mirroring
`extension.ts` → `reloadBlocks()`.

Tools:
- `get_diagram_format`, `list_blocks`, `get_block_schema` — progressive disclosure of the catalog
  (terse index → per-block schema) so the agent pulls only what it needs.
- **`validate_diagram`** — the keystone: compiles a candidate graph and returns errors/warnings +
  resource usage vs. the 128-instr / 32-reg / 32768-word budgets, so agents run a
  generate→validate→fix loop instead of reasoning about correctness in prose.
- `get_atl_reference`, `get_block_source`, **`create_custom_block`**, `list_custom_blocks`,
  `delete_custom_block` — author and manage *new* `.atl` blocks on the fly. `get_atl_reference`
  returns the bundled ATL spec (copied to `dist/atl-reference.md` at build time because
  `node_modules` is excluded from the `.vsix` — read via `__dirname`). `get_block_source` returns an
  existing block's raw `.atl` (via `getRawTemplate()`, straight from the in-memory registry) as a
  worked example. `create_custom_block` parse-checks, writes the file, `rebuildRegistry()`s, and runs
  a **probe compile** (auto-wires ADC/DAC to each audio port) before returning — the block is then
  immediately usable in `validate_diagram`. `list_custom_blocks` / `delete_custom_block` manage only
  files in the write dir (never built-ins). BlockRegistry has no single-block unregister, so
  create/delete call `rebuildRegistry()` (clear + reload manifest + all load dirs).
- `get_example` — returns a curated, compiler-validated `.spndiagram` for a common archetype (call
  with no arg to list; adapt rather than start from scratch). Sources live in
  [src/mcp/examples/](src/mcp/examples/), copied to `dist/mcp-examples/` at build time. **Every
  example must compile** — if you add one, validate it against `GraphCompiler` first.

**stdout is reserved for JSON-RPC** — the server reroutes `console.log`→stderr; never `console.log`
to stdout from here or you corrupt the protocol.

**Where new blocks are written** ([src/blockDiagram/blockLoading.ts](src/blockDiagram/blockLoading.ts)):
the **agent write dir** = the first `fv1.customBlockPaths` entry if the setting is set, else a
managed `<workspaceRoot>/.fv1/blocks` fallback (so it works with zero config). The extension passes
it as `--agent-block-path`. `blockLoading.ts` centralizes all registry loading (`reloadBlocks`,
`resolveCustomBlockPaths`) so extension.ts, `fv1.refreshBlocks`, the MCP launch args, and the file
watcher all agree. Because the server is a separate process, extension.ts runs a
`FileSystemWatcher` on the write dir → `reloadBlocks()` + `refreshAll()` so agent-authored blocks
appear in the editor live.

Two delivery paths, one bundle ([src/mcp/mcpIntegration.ts](src/mcp/mcpIntegration.ts)):
- **Copilot / VS Code MCP host** — `vscode.lm.registerMcpServerDefinitionProvider` +
  `mcpServerDefinitionProviders` contribution. Launched as `process.execPath` with
  `ELECTRON_RUN_AS_NODE=1` (VS Code's own Node — no system Node needed). Registration is still
  **guarded** (`any`-cast + `typeof` check) as belt-and-suspenders. The MCP provider API needs
  VS Code ≥ 1.101, so `engines.vscode` is `^1.101.0`.
- **Claude Code** — has its own MCP client and does **not** read VS Code's provider registrations,
  so we bootstrap it by writing a project-scoped `.mcp.json` behind the `fv1.setupClaudeCodeMcp`
  command + a one-time opt-in prompt. It launches the **same** `process.execPath` +
  `ELECTRON_RUN_AS_NODE=1`, so Claude Code needs **no separate Node** — just VS Code. The path is
  machine-specific, so `.mcp.json` is local-only (don't commit); an existing entry is silently
  refreshed on activation so extension updates don't leave a stale command.

## Custom blocks

`fv1.customBlockPaths` setting + "FV-1: Refresh Custom Blocks" lets users load external `.atl`
blocks; the MCP `create_custom_block` tool writes into the first such path (see above). Optimization
level for the block compiler is `fv1.optimizationLevel` (default 2).
