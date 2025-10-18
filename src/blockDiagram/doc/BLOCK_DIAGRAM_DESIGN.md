# FV-1 Block Diagram Visual Programming Design

## Overview

This document outlines the architecture for a visual block-diagram programming environment for the FV-1 DSP, integrated into the VS Code extension. The system allows users to create FV-1 programs by connecting graphical blocks representing audio effects, I/O, and DSP operations.

## Architecture

### 1. File Format (.spndiagram)

```json
{
  "version": "1.0",
  "metadata": {
    "name": "My Effect",
    "author": "User",
    "description": "Custom reverb with delay"
  },
  "canvas": {
    "zoom": 1.0,
    "panX": 0,
    "panY": 0
  },
  "blocks": [
    {
      "id": "block_uuid_1",
      "type": "input.adcl",
      "position": { "x": 100, "y": 200 },
      "parameters": {}
    },
    {
      "id": "block_uuid_2",
      "type": "fx.delay",
      "position": { "x": 400, "y": 200 },
      "parameters": {
        "delayTime": 0.5,
        "feedback": 0.6
      }
    }
  ],
  "connections": [
    {
      "id": "conn_uuid_1",
      "from": { "blockId": "block_uuid_1", "output": 0 },
      "to": { "blockId": "block_uuid_2", "input": 0 }
    }
  ]
}
```

### 2. Block Definition System

Each block is defined by a TypeScript class implementing the `IBlockDefinition` interface:

```typescript
interface IBlockDefinition {
  // Metadata
  type: string;                    // e.g., "fx.delay", "input.pot0"
  category: string;                // "Input", "Output", "Effect", "Math"
  name: string;                    // Display name
  description: string;
  
  // Visual properties
  color: string;                   // Block color
  icon?: string;                   // SVG icon path
  width: number;                   // Block width in pixels
  height: number;                  // Block height in pixels
  
  // I/O definition
  inputs: BlockPort[];
  outputs: BlockPort[];
  
  // Parameters (knobs, switches)
  parameters: BlockParameter[];
  
  // Code generation
  generateCode(context: CodeGenContext): string[];
  
  // Validation
  validate(context: ValidationContext): ValidationResult;
}

interface BlockPort {
  id: string;
  name: string;
  type: "audio" | "control";      // Audio rate vs control rate
  required?: boolean;
}

interface BlockParameter {
  id: string;
  name: string;
  type: "number" | "select" | "boolean";
  default: any;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{label: string, value: any}>;
}
```

### 3. Component Structure

```
src/
├── blockDiagram/
│   ├── editor/
│   │   ├── BlockDiagramEditor.ts          # VS Code custom editor
│   │   ├── BlockDiagramDocument.ts        # Document model
│   │   └── webview/                       # Webview UI
│   │       ├── index.html
│   │       ├── index.tsx                  # React entry point
│   │       ├── components/
│   │       │   ├── Canvas.tsx             # Main canvas component
│   │       │   ├── Block.tsx              # Block rendering
│   │       │   ├── Connection.tsx         # Wire rendering
│   │       │   ├── Toolbar.tsx            # Block palette
│   │       │   └── PropertyPanel.tsx      # Block properties
│   │       ├── hooks/
│   │       │   ├── useCanvas.ts           # Canvas zoom/pan
│   │       │   ├── useDragDrop.ts         # Drag and drop
│   │       │   └── useSelection.ts        # Selection management
│   │       └── styles/
│   │           └── editor.css
│   │
│   ├── blocks/
│   │   ├── BlockRegistry.ts               # Central block registry
│   │   ├── base/
│   │   │   └── BaseBlock.ts               # Abstract base class
│   │   ├── input/
│   │   │   ├── ADCLBlock.ts               # Left ADC input
│   │   │   ├── ADCRBlock.ts               # Right ADC input
│   │   │   └── PotBlock.ts                # Potentiometer input
│   │   ├── output/
│   │   │   ├── DACLBlock.ts               # Left DAC output
│   │   │   └── DACRBlock.ts               # Right DAC output
│   │   ├── effects/
│   │   │   ├── DelayBlock.ts              # Delay effect
│   │   │   ├── ReverbBlock.ts             # Reverb effect
│   │   │   ├── ChorusBlock.ts             # Chorus effect
│   │   │   └── LFOBlock.ts                # LFO modulation
│   │   ├── math/
│   │   │   ├── MixerBlock.ts              # Audio mixer
│   │   │   ├── GainBlock.ts               # Gain/attenuation
│   │   │   ├── FilterBlock.ts             # Low/high pass filter
│   │   │   └── MathBlock.ts               # Math operations
│   │   └── memory/
│   │       └── DelayLineBlock.ts          # Raw delay memory
│   │
│   ├── compiler/
│   │   ├── GraphCompiler.ts               # Main compilation orchestrator
│   │   ├── TopologicalSort.ts             # Dependency resolution
│   │   ├── RegisterAllocator.ts           # REG0-REG31 allocation
│   │   ├── MemoryAllocator.ts             # Delay memory allocation
│   │   ├── CodeGenerator.ts               # Final ASM generation
│   │   └── Optimizer.ts                   # Optional optimization
│   │
│   ├── validation/
│   │   ├── GraphValidator.ts              # Validate graph structure
│   │   ├── ConnectionValidator.ts         # Validate connections
│   │   └── ResourceValidator.ts           # Check memory/register limits
│   │
│   └── types/
│       ├── Block.ts                       # Block type definitions
│       ├── Connection.ts                  # Connection types
│       ├── Graph.ts                       # Graph data structure
│       └── CodeGenContext.ts              # Code generation context
```

### 4. Canvas Technology Stack

**Recommendation: React + Konva.js (Canvas-based) or React + SVG**

**Option A: Konva.js (Recommended)**
- High performance canvas rendering
- Built-in zoom, pan, drag-drop
- Event handling for interactive elements
- Great for complex diagrams with many elements

**Option B: React + SVG**
- More accessible DOM manipulation
- Easier debugging
- Better for smaller diagrams
- Native browser zoom

**Chosen: Konva.js for scalability**

### 5. Key Features Implementation

#### 5.1 Zoom and Pan
```typescript
class CanvasController {
  private zoom: number = 1.0;
  private panX: number = 0;
  private panY: number = 0;
  
  handleWheel(e: WheelEvent) {
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    this.zoom = Math.max(0.1, Math.min(5.0, this.zoom * zoomFactor));
    this.updateTransform();
  }
  
  handlePan(deltaX: number, deltaY: number) {
    this.panX += deltaX;
    this.panY += deltaY;
    this.updateTransform();
  }
  
  screenToWorld(x: number, y: number) {
    return {
      x: (x - this.panX) / this.zoom,
      y: (y - this.panY) / this.zoom
    };
  }
}
```

#### 5.2 Connection Drawing (Bezier Curves)
```typescript
function drawConnection(
  from: {x: number, y: number},
  to: {x: number, y: number}
): string {
  const dx = to.x - from.x;
  const controlPoint1X = from.x + dx * 0.5;
  const controlPoint2X = to.x - dx * 0.5;
  
  return `M ${from.x} ${from.y} 
          C ${controlPoint1X} ${from.y}, 
            ${controlPoint2X} ${to.y}, 
            ${to.x} ${to.y}`;
}
```

#### 5.3 Drag and Drop
```typescript
interface DragState {
  isDragging: boolean;
  dragType: 'block' | 'connection' | 'canvas';
  draggedItem?: string;
  startPos: {x: number, y: number};
  currentPos: {x: number, y: number};
}

// Drag block from palette
handleBlockDragStart(blockType: string, e: DragEvent) {
  this.dragState = {
    isDragging: true,
    dragType: 'block',
    draggedItem: blockType,
    startPos: this.getMousePos(e),
    currentPos: this.getMousePos(e)
  };
}

// Drop block on canvas
handleBlockDrop(e: DragEvent) {
  const worldPos = this.screenToWorld(e.clientX, e.clientY);
  this.createBlock(this.dragState.draggedItem!, worldPos);
  this.dragState.isDragging = false;
}
```

### 6. Block Library Definition

```typescript
// Example: Delay Block
export class DelayBlock extends BaseBlock {
  constructor() {
    super();
    this.type = 'fx.delay';
    this.category = 'Effects';
    this.name = 'Delay';
    this.description = 'Simple delay effect';
    this.color = '#4CAF50';
    
    this.inputs = [
      { id: 'in', name: 'Input', type: 'audio', required: true }
    ];
    
    this.outputs = [
      { id: 'out', name: 'Output', type: 'audio' }
    ];
    
    this.parameters = [
      {
        id: 'delayTime',
        name: 'Delay Time',
        type: 'number',
        default: 0.5,
        min: 0.0,
        max: 1.0,
        step: 0.01
      },
      {
        id: 'feedback',
        name: 'Feedback',
        type: 'number',
        default: 0.5,
        min: 0.0,
        max: 0.95,
        step: 0.01
      },
      {
        id: 'mix',
        name: 'Wet/Dry Mix',
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
    const input = ctx.getInputRegister(this.id, 'in');
    const output = ctx.allocateRegister(this.id, 'out');
    const delayMem = ctx.allocateMemory(this.id, 32768); // Max delay
    const fbReg = ctx.allocateRegister(this.id, 'feedback');
    
    const delayTime = this.getParameter('delayTime');
    const feedback = this.getParameter('feedback');
    const mix = this.getParameter('mix');
    
    const delaySamples = Math.floor(delayTime * 32768);
    
    code.push(`; Delay Block: ${this.id}`);
    code.push(`rdax ${input}, 1.0          ; Read input`);
    code.push(`wra ${delayMem.name}, 0.0    ; Write to delay line`);
    code.push(`rda ${delayMem.name}#, ${mix} ; Read delayed, mix`);
    code.push(`rdax ${input}, ${1.0 - mix}   ; Add dry signal`);
    code.push(`wrax ${output}, ${feedback}   ; Write output, keep for feedback`);
    code.push(`wra ${delayMem.name}, 0.0     ; Write feedback to delay`);
    code.push('');
    
    return code;
  }
  
  validate(ctx: ValidationContext): ValidationResult {
    if (!ctx.hasInput(this.id, 'in')) {
      return { valid: false, error: 'Input must be connected' };
    }
    return { valid: true };
  }
}
```

### 7. Compilation Pipeline

```typescript
export class GraphCompiler {
  compile(graph: BlockGraph): CompilationResult {
    // 1. Validate graph
    const validation = this.validator.validate(graph);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }
    
    // 2. Topological sort (determine execution order)
    const executionOrder = this.topologicalSort(graph);
    
    // 3. Allocate resources
    const context = new CodeGenContext();
    this.registerAllocator.allocate(graph, context);
    this.memoryAllocator.allocate(graph, context);
    
    // 4. Generate code for each block in order
    const code: string[] = [];
    code.push('; Generated by FV-1 Block Diagram Editor');
    code.push('; Program: ' + graph.metadata.name);
    code.push('');
    
    // Memory declarations
    context.getMemoryBlocks().forEach(mem => {
      code.push(`${mem.name} equ ${mem.size}`);
    });
    code.push('');
    
    // Generate block code in execution order
    for (const blockId of executionOrder) {
      const block = graph.blocks.find(b => b.id === blockId);
      const definition = this.registry.getBlock(block.type);
      const blockCode = definition.generateCode(context);
      code.push(...blockCode);
    }
    
    // 5. Optimize (optional)
    const optimizedCode = this.optimizer.optimize(code);
    
    return {
      success: true,
      assembly: optimizedCode.join('\n'),
      statistics: {
        instructionsUsed: optimizedCode.length,
        registersUsed: context.getUsedRegisterCount(),
        memoryUsed: context.getUsedMemorySize()
      }
    };
  }
  
  private topologicalSort(graph: BlockGraph): string[] {
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    
    const visit = (blockId: string) => {
      if (visited.has(blockId)) return;
      if (visiting.has(blockId)) {
        throw new Error('Circular dependency detected');
      }
      
      visiting.add(blockId);
      
      // Visit all dependencies (blocks feeding into this one)
      const dependencies = this.getDependencies(graph, blockId);
      dependencies.forEach(depId => visit(depId));
      
      visiting.delete(blockId);
      visited.add(blockId);
      sorted.push(blockId);
    };
    
    // Start from output blocks
    const outputBlocks = graph.blocks.filter(b => 
      b.type.startsWith('output.')
    );
    
    outputBlocks.forEach(block => visit(block.id));
    
    return sorted;
  }
}
```

### 8. VS Code Integration

```typescript
export class BlockDiagramEditorProvider 
  implements vscode.CustomTextEditorProvider {
  
  public static readonly viewType = 'fv1.blockDiagramEditor';
  
  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<void> {
    
    // Setup webview
    webviewPanel.webview.options = {
      enableScripts: true,
    };
    
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
    
    // Handle messages from webview
    webviewPanel.webview.onDidReceiveMessage(e => {
      switch (e.type) {
        case 'compile':
          this.compileGraph(document, e.graph);
          break;
        case 'save':
          this.updateDocument(document, e.graph);
          break;
      }
    });
    
    // Send initial document content
    this.updateWebview(document, webviewPanel.webview);
  }
  
  private async compileGraph(
    document: vscode.TextDocument,
    graph: any
  ) {
    const compiler = new GraphCompiler(blockRegistry);
    const result = compiler.compile(graph);
    
    if (result.success) {
      // Create .spn file
      const spnPath = document.uri.fsPath.replace('.spndiagram', '.spn');
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(spnPath),
        Buffer.from(result.assembly, 'utf8')
      );
      
      vscode.window.showInformationMessage(
        `Compiled successfully! ${result.statistics.instructionsUsed}/128 instructions used.`
      );
    } else {
      vscode.window.showErrorMessage(
        `Compilation failed: ${result.errors.join(', ')}`
      );
    }
  }
}
```

### 9. React Component Structure

```typescript
// Main Canvas Component
export const BlockDiagramCanvas: React.FC = () => {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  
  const { zoom, pan, handleZoom, handlePan } = useCanvas();
  const { handleDragStart, handleDrop } = useDragDrop();
  
  return (
    <div className="canvas-container">
      <Toolbar onBlockDragStart={handleDragStart} />
      
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
          {/* Render connections first (behind blocks) */}
          {connections.map(conn => (
            <Connection key={conn.id} connection={conn} />
          ))}
          
          {/* Render blocks */}
          {blocks.map(block => (
            <Block
              key={block.id}
              block={block}
              isSelected={selectedBlock === block.id}
              onSelect={() => setSelectedBlock(block.id)}
            />
          ))}
        </Layer>
      </Stage>
      
      {selectedBlock && (
        <PropertyPanel
          block={blocks.find(b => b.id === selectedBlock)}
          onUpdate={handleBlockUpdate}
        />
      )}
    </div>
  );
};
```

### 10. Initial Block Library

**Must-Have Blocks:**
- **Input**: ADCL, ADCR, POT0, POT1, POT2
- **Output**: DACL, DACR
- **Effects**: Delay, Reverb, Chorus, Flanger, Phaser
- **Math**: Mixer, Gain, Invert, Abs
- **Filters**: LPF, HPF, All-pass
- **Modulation**: LFO (Sine, Triangle, Ramp)
- **Memory**: Delay Line, Circular Buffer
- **Control**: Switch, Crossfade

## Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] File format definition
- [ ] Block definition interface
- [ ] Basic canvas with zoom/pan
- [ ] Block palette UI
- [ ] Drag and drop blocks

### Phase 2: Connections (Week 2)
- [ ] Connection drawing
- [ ] Port hit detection
- [ ] Connection validation
- [ ] Delete connections

### Phase 3: Core Blocks (Week 3)
- [ ] Input/Output blocks
- [ ] Basic math blocks
- [ ] Simple delay block
- [ ] Mixer block

### Phase 4: Compiler (Week 4)
- [ ] Topological sort
- [ ] Register allocation
- [ ] Memory allocation
- [ ] Code generation
- [ ] Validation

### Phase 5: Advanced Features (Week 5+)
- [ ] More effect blocks
- [ ] Undo/redo
- [ ] Copy/paste
- [ ] Block grouping
- [ ] Templates/presets

## Technical Considerations

### Performance
- Use virtualization for large block palettes
- Debounce expensive operations
- Use memoization for React components
- Canvas pooling for many connections

### Memory Management
- FV-1 has 32768 words of delay memory
- FV-1 has 32 general-purpose registers (REG0-REG31)
- 128 instruction limit
- Smart allocation strategies needed

### User Experience
- Snap to grid (optional)
- Auto-layout suggestions
- Error highlighting on blocks
- Real-time compilation feedback
- Instruction count indicator

## File Structure
```
.spndiagram - Block diagram source (JSON)
.spn        - Generated assembly (auto-created on compile)
.hex        - Optional: compiled binary
```

## Future Enhancements
- Block library marketplace
- Custom block creation UI
- Oscilloscope/spectrum analyzer preview
- MIDI CC mapping to parameters
- Real-time audio preview (via WebAudio API simulation)
- Version control diff viewer
- Collaborative editing
