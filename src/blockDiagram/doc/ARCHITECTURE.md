# FV-1 Block Diagram System Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE LAYER                         │
│                    (To be implemented - Phase 3)                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐               │
│  │    Block     │  │  Connection  │  │  Property   │               │
│  │   Palette    │  │   Drawing    │  │   Panel     │               │
│  │              │  │   (Bezier)   │  │             │               │
│  └──────────────┘  └──────────────┘  └─────────────┘               │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │           Canvas (Konva.js recommended)                  │       │
│  │  - Zoom/Pan controls                                     │       │
│  │  - Block rendering                                       │       │
│  │  - Drag and drop                                         │       │
│  │  - Connection routing                                    │       │
│  └──────────────────────────────────────────────────────────┘       │
│                                                                       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ Messages (compile, save, etc.)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      GRAPH MODEL LAYER ✅                            │
│                           (Implemented)                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌────────────────────────────────────────────────────┐             │
│  │  BlockGraph (.spndiagram file)                     │             │
│  │  ┌──────────────────────────────────────────────┐  │             │
│  │  │ metadata: { name, author, description }     │  │             │
│  │  │ canvas: { zoom, panX, panY }                │  │             │
│  │  │ blocks: [                                   │  │             │
│  │  │   { id, type, position, parameters }        │  │             │
│  │  │ ]                                           │  │             │
│  │  │ connections: [                              │  │             │
│  │  │   { id, from, to }                          │  │             │
│  │  │ ]                                           │  │             │
│  │  └──────────────────────────────────────────────┘  │             │
│  └────────────────────────────────────────────────────┘             │
│                                                                       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ Graph data
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    COMPILATION PIPELINE ✅                           │
│                           (Implemented)                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │ 1. GraphValidator                                       │        │
│  │    - Check for required blocks (inputs/outputs)        │        │
│  │    - Validate connections                              │        │
│  │    - Check port compatibility                          │        │
│  └────────────────────┬────────────────────────────────────┘        │
│                       │ Valid graph                                 │
│                       ▼                                              │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │ 2. TopologicalSort                                      │        │
│  │    - Build dependency graph                            │        │
│  │    - Detect circular dependencies                      │        │
│  │    - Determine execution order                         │        │
│  └────────────────────┬────────────────────────────────────┘        │
│                       │ Sorted block IDs                            │
│                       ▼                                              │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │ 3. CodeGenerationContext                                │        │
│  │    - Allocate registers (REG0-REG31)                   │        │
│  │    - Allocate delay memory (0-32767)                   │        │
│  │    - Track resource usage                              │        │
│  └────────────────────┬────────────────────────────────────┘        │
│                       │ Context ready                               │
│                       ▼                                              │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │ 4. Code Generation (for each block in order)           │        │
│  │    - Call block.generateCode(context)                  │        │
│  │    - Collect assembly lines                            │        │
│  │    - Add headers and memory declarations               │        │
│  └────────────────────┬────────────────────────────────────┘        │
│                       │ FV-1 Assembly                               │
│                       ▼                                              │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │ 5. Resource Check & Output                             │        │
│  │    - Count instructions (max 128)                      │        │
│  │    - Report statistics                                 │        │
│  │    - Generate .spn file                                │        │
│  └─────────────────────────────────────────────────────────┘        │
│                                                                       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ Assembly code
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    EXISTING ASSEMBLER ✅                             │
│                         (Already exists)                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Your existing FV1Assembler                                          │
│  - Assembles .spn to machine code                                   │
│  - Programs to EEPROM                                                │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

## Block System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BLOCK REGISTRY                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Categories:                                                         │
│  ┌─────────────┬──────────────┬──────────────┬──────────────┐       │
│  │   Input     │   Output     │   Effects    │     Math     │       │
│  ├─────────────┼──────────────┼──────────────┼──────────────┤       │
│  │  ✅ ADCL    │  ✅ DACL     │  ✅ Delay    │  ✅ Gain     │       │
│  │  ✅ ADCR    │  ✅ DACR     │  ⬜ Reverb   │  ✅ Mixer    │       │
│  │  ✅ POT     │              │  ⬜ Chorus   │  ⬜ Filter   │       │
│  │             │              │  ⬜ Flanger  │  ⬜ LFO      │       │
│  └─────────────┴──────────────┴──────────────┴──────────────┘       │
│                                                                       │
│  Legend: ✅ Implemented  ⬜ To be added                               │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

## Block Structure

```
┌─────────────────────────────────────────────────────────────┐
│                         BLOCK                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Metadata                                                   │
│  ┌────────────────────────────────────────────┐            │
│  │ type: "fx.delay"                           │            │
│  │ category: "Effects"                        │            │
│  │ name: "Delay"                              │            │
│  │ description: "Simple delay with feedback"  │            │
│  │ color: "#4CAF50"                           │            │
│  └────────────────────────────────────────────┘            │
│                                                             │
│  Inputs/Outputs                                             │
│  ┌────────────┐                    ┌────────────┐          │
│  │ Input:     │                    │ Output:    │          │
│  │  • in      │ ──── [Block] ────► │  • out     │          │
│  │   (audio)  │                    │   (audio)  │          │
│  └────────────┘                    └────────────┘          │
│                                                             │
│  Parameters                                                 │
│  ┌────────────────────────────────────────────┐            │
│  │ delayTime: 0.5 (0.0 - 1.0)                │            │
│  │ feedback: 0.6 (0.0 - 0.99)                │            │
│  │ mix: 0.5 (0.0 - 1.0)                      │            │
│  └────────────────────────────────────────────┘            │
│                                                             │
│  Code Generation                                            │
│  ┌────────────────────────────────────────────┐            │
│  │ generateCode(ctx) {                        │            │
│  │   - Allocate registers                     │            │
│  │   - Allocate memory                        │            │
│  │   - Generate FV-1 assembly                 │            │
│  │ }                                          │            │
│  └────────────────────────────────────────────┘            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Resource Management

```
┌─────────────────────────────────────────────────────────────┐
│                 FV-1 HARDWARE RESOURCES                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Registers (32 total)                                       │
│  ┌──────────────────────────────────────────────────┐      │
│  │ REG0  REG1  REG2  REG3  ...  REG30  REG31        │      │
│  │  ▓▓    ▓▓    ▓▓    ░░   ...   ░░     ░░          │      │
│  │ Used  Used  Used  Free  ...  Free   Free         │      │
│  └──────────────────────────────────────────────────┘      │
│  ▓ = Allocated by compiler                                  │
│  ░ = Available                                              │
│                                                             │
│  Delay Memory (32,768 words)                                │
│  ┌──────────────────────────────────────────────────┐      │
│  │ 0      9830            16000              32768  │      │
│  │ ├────────┼─────────────────┼────────────────┤    │      │
│  │ │Delay 1 │  Delay 2        │    Free        │    │      │
│  │ │ 9830   │   6170          │    16768       │    │      │
│  │ │ words  │   words         │    words       │    │      │
│  └──────────────────────────────────────────────────┘      │
│                                                             │
│  Instructions (128 max)                                     │
│  ┌──────────────────────────────────────────────────┐      │
│  │ [▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░] 45/128 │      │
│  └──────────────────────────────────────────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow Example

```
User Creates Diagram → Graph JSON → Compiler → FV-1 Assembly → Existing Assembler → EEPROM

Step 1: User drags blocks and connects them
┌──────┐      ┌────────┐      ┌──────┐
│ ADCL ├─────►│ Delay  ├─────►│ DACL │
└──────┘      └────────┘      └──────┘
  |              |                |
  |      delayTime: 0.3s          |
  |      feedback: 0.6            |
  |      mix: 0.5                 |

Step 2: Graph JSON (.spndiagram)
{
  "blocks": [
    { "id": "b1", "type": "input.adcl", "position": {...} },
    { "id": "b2", "type": "fx.delay", "parameters": {...} },
    { "id": "b3", "type": "output.dacl", "position": {...} }
  ],
  "connections": [
    { "from": {"blockId": "b1", "portId": "out"}, "to": {"blockId": "b2", "portId": "in"} },
    { "from": {"blockId": "b2", "portId": "out"}, "to": {"blockId": "b3", "portId": "in"} }
  ]
}

Step 3: Compiler processes
- Topological sort: [b1, b2, b3]
- Allocate: REG0 (b1), REG1 (b2), mem_b2 (9830 words)
- Generate code for each block

Step 4: FV-1 Assembly (.spn)
mem_b2  equ  9830

; Left ADC Input
rdax ADCL, 1.0
wrax REG0, 0.0

; Delay Effect
rdax REG0, 1.0
rda mem_b2#, 0.5
wra mem_b2, 0.6
rdax REG0, 0.5
wrax REG1, 0.0

; Left DAC Output
rdax REG1, 1.0
wrax DACL, 0.0

Step 5: Your existing assembler → machine code → EEPROM
```

## File Structure

```
fv1-vscode/
├── src/
│   ├── extension.ts                 ← Your existing code
│   ├── FV1Assembler.ts             ← Your existing assembler
│   ├── hexParser.ts                ← Your existing parser
│   ├── SpnBanksProvider.ts         ← Your existing provider
│   │
│   └── blockDiagram/               ← NEW: Block diagram system
│       │
│       ├── types/                  ← ✅ Type definitions
│       │   ├── Block.ts
│       │   ├── Connection.ts
│       │   ├── Graph.ts
│       │   └── CodeGenContext.ts
│       │
│       ├── blocks/                 ← ✅ Block library
│       │   ├── BlockRegistry.ts
│       │   ├── base/
│       │   │   └── BaseBlock.ts
│       │   ├── input/
│       │   │   └── InputBlocks.ts
│       │   ├── output/
│       │   │   └── OutputBlocks.ts
│       │   ├── math/
│       │   │   └── MathBlocks.ts
│       │   └── effects/
│       │       └── DelayBlock.ts
│       │
│       ├── compiler/               ← ✅ Compilation pipeline
│       │   ├── GraphCompiler.ts
│       │   └── TopologicalSort.ts
│       │
│       ├── editor/                 ← TODO: VS Code integration
│       │   ├── BlockDiagramEditor.ts
│       │   ├── BlockDiagramDocument.ts
│       │   └── webview/
│       │       ├── index.html
│       │       ├── index.tsx
│       │       └── components/
│       │
│       ├── examples/               ← ✅ Working examples
│       │   └── CompilationExample.ts
│       │
│       └── README.md               ← ✅ Implementation guide
│
├── BLOCK_DIAGRAM_DESIGN.md         ← ✅ Complete design doc
└── BLOCK_DIAGRAM_QUICKSTART.md     ← ✅ Quick start guide
```

## Implementation Status

✅ **COMPLETE (Ready to use)**
- Type system
- Block definition framework
- Block registry
- Input/output blocks
- Simple math blocks
- Delay effect block
- Topological sort
- Code generation context
- Graph compiler
- Validation system
- Working examples
- Complete documentation

⬜ **TODO (Next steps)**
- React UI components
- Konva.js canvas integration
- VS Code custom editor
- Webview HTML/CSS
- More effect blocks
- Advanced features (undo/redo, etc.)

## Next Implementation Steps

1. **Set up React + Konva.js**
   ```bash
   npm install react react-dom react-konva konva
   npm install --save-dev @types/react @types/react-dom
   ```

2. **Create webview structure**
   - `src/blockDiagram/editor/webview/index.html`
   - `src/blockDiagram/editor/webview/index.tsx`
   - Basic canvas with one block type

3. **Implement custom editor provider**
   - `src/blockDiagram/editor/BlockDiagramEditor.ts`
   - Register in `package.json`
   - Register in `extension.ts`

4. **Add block palette UI**
   - Drag-and-drop from palette to canvas

5. **Implement connection drawing**
   - Bezier curves between ports

6. **Wire up compiler**
   - "Compile" button → calls GraphCompiler
   - Display errors on blocks
   - Show statistics

The foundation is **rock solid** - now it's time to build the visual layer! 🎨
