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

## Bank programming & HEX export (one assemble step, two consumers)

`PedalSimulatorView.assembleBank()` assembles every assigned slot of the **in-memory** bank and is
the single source for both "Program bank to pedal" and the toolbar's "Export .hex…". They used to
be separate implementations that disagreed — programming aborted on an assembly error while the
old export silently skipped the slot — so keep them on the shared helper. Unassigned slots are
simply absent from the result (that is the sparse contract); a slot that *should* have produced
code but didn't comes back in `broken`, and both consumers abort on that.

**Export is sparse by design** (verified: zero HEX data records inside an omitted slot's address
range, so flashing leaves that region of EEPROM untouched). ⚠️ **`IntelHexParser.parse()` flattens
gaps to 0xFF**, so the `fv1.loadHexToEeprom` path — which parses then writes the flat buffer from
address 0 — will *erase* omitted slots on the way back in. Sparseness survives the file and any
flasher that honours record addresses; it does not survive our own load command.

Export works on an unsaved, in-memory bank; programming still calls `ensureBankSaved()` first,
which is deliberate (programming the hardware is a commit point, so the .spnbank should match).

## GP0 bus lock — every EEPROM access

On the stereo Easy Spin the on-board MCU is a second I²C master and only releases the bus while
GP0 is high. `getEepromConnection()` therefore returns `{ eeprom, busLock }`, and **every**
`eeprom.read` / `eeprom.write` in this service must sit inside `busLock.run(...)` — reads too, not
just writes. Grep for `eeprom.read|eeprom.write` after touching this file; anything outside a
`run()` is a bug. `readAllSlotsFromPedal` goes through `PedalClient`, which locks internally.

Each logical operation takes **one** lock: write + verify together, and the whole multi-segment
HEX load in a single hold, so the MCU is never let back on the bus mid-operation. On hardware
without the line the lock is inert. Verified on a real stereo pedal: GP0 high for the full 1.6 s
read, low afterwards, and released on the throw path too.

## Read from pedal

The toolbar's **Read Pedal** button (always visible — it is how you get a bank when you have
none) rebuilds the bank from the hardware: `ProgrammerService.readAllSlotsFromPedal()` reads all
8 slots via fv1-core's `PedalClient` (direct-drive read, ~2.5x faster than the `EEPROM` wrapper
and no spurious `checkRead` warnings), then `PedalSimulatorView.readPedalIntoBank()` disassembles
each non-blank slot to `<bank>-from-pedal/slot-N.spn` and assigns it.

Because the output is real `.spn`, **no new bank-model concepts were needed** — slots stay paths,
and simulate / edit / re-assemble / re-program all work unchanged. Verified against hardware: all
8 slots of a programmed pedal disassembled and re-assembled byte-identically, including a
127-instruction program.

- **Blank slots (all 0xFF) are left unassigned**, not stubbed — the same sparse treatment as HEX
  export.
- A dirty bank prompts before being replaced; the read reassigns every slot.
- The target directory is resolved *before* the read, so we never read the pedal and then discover
  there is nowhere to put the files. Saved bank → a sibling `-from-pedal/` folder; unsaved bank →
  a folder picker.
- Generated files carry a header noting they came off the pedal and that comments, symbol names
  and block-diagram structure are not recoverable — they are not in the machine code.

## Pedal connection & identification

`ProgrammerService.openDevice()` is the single place a HID connection is made. It opens the
MCP2221, sets the I²C clock, then **identifies the pedal** (`identifyPedal` over the wire, falling
back to node-hid's `product` descriptor, finally `unknown`) and logs `Connected to <label>`.
Identification is never fatal — an unidentified device is still programmable the standard way.
The result rides on the returned connection (`connection.identity`) and is cached on
`programmerService.pedalIdentity` for programming paths that need to branch on stereo vs.
standard hardware. Branch on `identity.variant` / `identity.isStereo`, never on the USB
product string directly.

**Provisioning does not ship.** Writing MCP2221 flash (GP0 + Audiofab descriptors) is a
production step, not a user feature: it lives in `scripts/provision-stereo-pedal.mjs`, and
`scripts/` is in `.vscodeignore` so it never enters the `.vsix`. The write API itself is in
fv1-core (`provisionMcp2221`) — don't add a command that calls it.

## Custom blocks

`fv1.customBlockPaths` setting + "FV-1: Refresh Custom Blocks" lets users load external `.atl`
blocks; the MCP `create_custom_block` tool writes into the first such path (see above). Optimization
level for the block compiler is `fv1.optimizationLevel` (default 2).
