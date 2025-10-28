# FV-1 Block Diagram Programming - Implementation Guide

## 🎯 Quick Start

This is a foundational implementation for visual block-diagram programming for the FV-1 DSP chip. The system allows users to create audio effects by connecting graphical blocks rather than writing assembly code.

## 📁 Project Structure

```
src/blockDiagram/
├── types/              # Core type definitions
│   ├── Block.ts        # Block and port interfaces
│   ├── Connection.ts   # Connection definitions
│   ├── Graph.ts        # Graph data structure
│   └── CodeGenContext.ts # Code generation context
│
├── blocks/             # Block library
│   ├── BlockRegistry.ts    # Central block registry
│   ├── base/
│   │   └── BaseBlock.ts    # Abstract base class
│   ├── input/
│   │   └── InputBlocks.ts  # ADCL, ADCR, POT blocks
│   ├── output/
│   │   └── OutputBlocks.ts # DACL, DACR blocks
│   ├── math/
│   │   └── MathBlocks.ts   # Gain, Mixer blocks
│   └── effects/
│       └── DelayBlock.ts   # Simple delay effect
│
├── compiler/           # Compilation pipeline
│   ├── GraphCompiler.ts      # Main compiler
│   └── TopologicalSort.ts    # Dependency resolution
│
└── examples/
    └── CompilationExample.ts # Usage examples
```

## 🏗️ Core Concepts

### 1. Blocks

Blocks are the building blocks of your effect. Each block:
- Has **inputs** and **outputs** (audio or control signals)
- Has **parameters** (like delay time, feedback, etc.)
- Generates **FV-1 assembly code**

Example block types:
- **Input**: `ADCL`, `ADCR`, `POT0`-`POT2`
- **Output**: `DACL`, `DACR`
- **Effects**: `Delay`, `Reverb`, `Chorus`
- **Math**: `Gain`, `Mixer`

### 2. Connections

Connections wire blocks together. Each connection:
- Links one block's **output** to another block's **input**
- Transfers audio or control signals
- Defines the data flow

### 3. Compilation

The compiler:
1. **Validates** the graph (checks for missing connections, circular dependencies)
2. **Sorts** blocks topologically (determines execution order)
3. **Allocates** resources (registers, delay memory)
4. **Generates** FV-1 assembly code for each block
5. **Outputs** complete `.spn` file ready to assemble

## 🔧 Creating Custom Blocks

### Step 1: Extend BaseBlock

```typescript
import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class MyEffectBlock extends BaseBlock {
    readonly type = 'fx.myeffect';
    readonly category = 'Effects';
    readonly name = 'My Effect';
    readonly description = 'Custom audio effect';
    readonly color = '#9C27B0';
    
    constructor() {
        super();
        
        // Define inputs
        this._inputs = [
            { id: 'in', name: 'Input', type: 'audio', required: true }
        ];
        
        // Define outputs
        this._outputs = [
            { id: 'out', name: 'Output', type: 'audio' }
        ];
        
        // Define parameters
        this._parameters = [
            {
                id: 'amount',
                name: 'Effect Amount',
                type: 'number',
                default: 0.5,
                min: 0.0,
                max: 1.0,
                step: 0.01
            }
        ];
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        
        // Get input register
        const inputReg = ctx.getInputRegister(this.type, 'in');
        
        // Allocate output register
        const outputReg = ctx.allocateRegister(this.type, 'out');
        
        // Get parameter value
        const amount = this.getParameterValue(ctx, this.type, 'amount', 0.5);
        
        // Generate FV-1 assembly
        code.push('; My Effect Block');
        code.push(`rdax ${inputReg}, ${this.formatS1_14(amount)}`);
        code.push(`wrax ${outputReg}, 0.0`);
        code.push('');
        
        return code;
    }
}
```

### Step 2: Register Your Block

```typescript
// In BlockRegistry.ts
import { MyEffectBlock } from './effects/MyEffectBlock.js';

// In registerDefaultBlocks():
this.register(new MyEffectBlock());
```

## 📊 File Format (.spndiagram)

Block diagrams are saved as JSON:

```json
{
  "version": "1.0",
  "metadata": {
    "name": "My Delay Effect",
    "author": "Your Name",
    "description": "Cool delay pedal"
  },
  "canvas": {
    "zoom": 1.0,
    "panX": 0,
    "panY": 0
  },
  "blocks": [
    {
      "id": "block_123",
      "type": "input.adcl",
      "position": { "x": 100, "y": 200 },
      "parameters": { "gain": 1.0 }
    }
  ],
  "connections": [
    {
      "id": "conn_456",
      "from": { "blockId": "block_123", "portId": "out" },
      "to": { "blockId": "block_789", "portId": "in" }
    }
  ]
}
```

## 🎨 Canvas Technology Recommendations

For the visual editor, I recommend **Konva.js** with React:

### Why Konva.js?
- ✅ High performance Canvas rendering
- ✅ Built-in zoom, pan, drag-drop
- ✅ Event handling for interactive elements
- ✅ Scales well to hundreds of blocks
- ✅ Easy bezier curve drawing for connections

### Alternative: React + SVG
- ✅ Simpler DOM manipulation
- ✅ Better for accessibility
- ❌ Can be slower with many elements

### Basic Canvas Structure

```typescript
import { Stage, Layer, Rect, Circle, Line } from 'react-konva';

function BlockDiagramCanvas() {
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  
  return (
    <Stage
      width={window.innerWidth}
      height={window.innerHeight}
      scaleX={zoom}
      scaleY={zoom}
      x={pan.x}
      y={pan.y}
      onWheel={handleZoom}
    >
      <Layer>
        {/* Connections */}
        {connections.map(conn => (
          <ConnectionLine key={conn.id} connection={conn} />
        ))}
        
        {/* Blocks */}
        {blocks.map(block => (
          <BlockComponent key={block.id} block={block} />
        ))}
      </Layer>
    </Stage>
  );
}
```

## 🔌 VS Code Integration

### Custom Editor Provider

```typescript
export class BlockDiagramEditorProvider 
  implements vscode.CustomTextEditorProvider {
  
  public static readonly viewType = 'fv1.blockDiagramEditor';
  
  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<void> {
    // Setup webview with React app
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
    
    // Handle messages from webview
    webviewPanel.webview.onDidReceiveMessage(e => {
      switch (e.type) {
        case 'compile':
          this.compileGraph(document, e.graph);
          break;
      }
    });
  }
  
  private compileGraph(document: vscode.TextDocument, graph: any) {
    const compiler = new GraphCompiler(blockRegistry);
    const result = compiler.compile(graph);
    
    if (result.success) {
      // Save as .spn file
      const spnPath = document.uri.fsPath.replace('.spndiagram', '.spn');
      fs.writeFileSync(spnPath, result.assembly);
      
      vscode.window.showInformationMessage(
        `Compiled! ${result.statistics.instructionsUsed}/128 instructions`
      );
    }
  }
}
```

### Register in package.json

```json
{
  "contributes": {
    "customEditors": [
      {
        "viewType": "fv1.blockDiagramEditor",
        "displayName": "FV-1 Block Diagram",
        "selector": [
          {
            "filenamePattern": "*.spndiagram"
          }
        ]
      }
    ]
  }
}
```

## 📈 FV-1 Resource Limits

Keep these in mind when designing effects:

- **128 instructions** max
- **32 registers** (REG0-REG31)
- **32,768 words** delay memory
- **32.768 kHz** sample rate

The compiler will warn you if you exceed limits!

## 🧪 Testing

Run the example compilation:

```typescript
import { runCompilationTest } from './blockDiagram/examples/CompilationExample';

runCompilationTest();
```

This will create two test graphs and compile them, showing:
- Generated assembly code
- Resource usage statistics
- Any errors or warnings

## 🚀 Next Steps

### Phase 1: Core Implementation
- [ ] Implement canvas with Konva.js
- [ ] Block drag-and-drop from palette
- [ ] Connection drawing with bezier curves
- [ ] Basic block rendering

### Phase 2: Interactivity
- [ ] Block selection and deletion
- [ ] Connection creation by dragging from ports
- [ ] Parameter editing panel
- [ ] Zoom and pan controls

### Phase 3: Compilation
- [ ] "Compile" button to generate .spn file
- [ ] Display compilation errors on blocks
- [ ] Resource usage indicators
- [ ] Real-time validation

### Phase 4: Advanced Features
- [ ] Undo/redo
- [ ] Copy/paste blocks
- [ ] Block templates/presets
- [ ] Auto-layout algorithm

### Phase 5: More Blocks
- [ ] Reverb blocks
- [ ] Chorus/Flanger
- [ ] LFO modulation
- [ ] Filters (LPF, HPF, etc.)
- [ ] Envelope followers

## 💡 Design Patterns Used

### Factory Pattern
`BlockRegistry` acts as a factory for creating block instances

### Strategy Pattern
Each block implements its own `generateCode()` strategy

### Visitor Pattern
`GraphCompiler` visits each block in topological order

### Builder Pattern
`CodeGenerationContext` builds up resource allocations

## 🎓 Learning Resources

- **FV-1 Datasheet**: Official Spin Semiconductor documentation
- **SpinCAD Designer**: Reference implementation
- **Konva.js Docs**: https://konvajs.org/
- **VS Code Extension API**: https://code.visualstudio.com/api

## ❓ FAQ

**Q: Can I create blocks at runtime?**
A: Yes! Just create a new class extending `BaseBlock` and register it with `blockRegistry.register()`.

**Q: How do I handle errors in code generation?**
A: Throw an error from `generateCode()` and the compiler will catch it and report it to the user.

**Q: Can blocks have multiple outputs?**
A: Yes! Just add multiple entries to the `_outputs` array. Each output gets its own register.

**Q: How does memory allocation work?**
A: Call `ctx.allocateMemory(blockId, size)` to reserve delay memory. The compiler tracks total usage.

## 📝 License

MIT License - See LICENSE file in project root.
