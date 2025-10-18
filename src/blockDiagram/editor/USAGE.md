# Block Diagram Editor Usage Guide

## Getting Started

The FV-1 Block Diagram Editor provides a visual programming interface for designing DSP effects for the Spin Semiconductor FV-1 chip.

### Creating a New Diagram

1. Create a new file with the `.spndiagram` extension
2. The block diagram editor will open automatically
3. Start by dragging blocks from the left palette onto the canvas

### Basic Controls

#### Canvas Navigation
- **Zoom**: Mouse wheel or trackpad scroll
- **Pan**: Click and drag on empty canvas space
- **Select**: Click on blocks or connections

#### Working with Blocks
- **Add Block**: Drag from the left palette onto canvas
- **Move Block**: Drag the block to reposition it
- **Select Block**: Click on the block
- **Delete Block**: Select and press `Delete` or `Backspace`
- **Edit Parameters**: Select block to open property panel on the right

#### Making Connections
1. Click on an output port (right side of a block)
2. Drag to an input port (left side of another block)
3. Release to create the connection
4. Press `Escape` to cancel connection drawing

#### Deleting Connections
1. Click on a connection to select it
2. Press `Delete` or `Backspace`

### Keyboard Shortcuts

- `Delete` / `Backspace` - Delete selected block or connection
- `Escape` - Cancel current action (connection drawing, selection)

### Compiling

Click the **Compile** button in the toolbar to generate FV-1 assembly code from your block diagram. The compiler:

1. Validates the graph structure
2. Performs topological sorting to determine execution order
3. Generates optimized FV-1 assembly code
4. Reports any errors or warnings

### Block Library

#### Input Blocks (Blue)
- **ADCL** - Left audio input
- **ADCR** - Right audio input  
- **POT** - Hardware potentiometer (0-3)

#### Output Blocks (Green)
- **DACL** - Left audio output
- **DACR** - Right audio output

#### Math Blocks (Orange)
- **Gain** - Multiply signal by gain factor
- **Mixer** - Mix two signals together with level control

#### Effect Blocks (Purple)
- **Delay** - Simple delay effect

### Examples

See the `examples/` folder for sample diagrams:
- `simple-delay.spndiagram` - Basic delay effect
- `stereo-mixer-delay.spndiagram` - More complex stereo effect with mixing

### File Format

`.spndiagram` files are JSON documents with the following structure:

```json
{
  "blocks": [
    {
      "id": "unique-id",
      "type": "block.type",
      "position": { "x": 100, "y": 200 },
      "parameters": { }
    }
  ],
  "connections": [
    {
      "id": "conn-id",
      "from": {
        "blockId": "source-block-id",
        "portId": "output-port-id"
      },
      "to": {
        "blockId": "dest-block-id",
        "portId": "input-port-id"
      }
    }
  ],
  "canvas": {
    "zoom": 1.0,
    "panX": 0,
    "panY": 0
  }
}
```

### Tips

- Start with input blocks (ADCL/ADCR) and end with output blocks (DACL/DACR)
- Use the zoom controls to work with large diagrams
- The property panel shows all parameters for the selected block
- Connections are drawn as bezier curves for visual clarity
- The compiler will detect cycles and other graph errors

### Advanced Features

#### Custom Blocks

To add your own custom blocks:

1. Create a new class implementing `IBlockDefinition` in `src/blockDiagram/blocks/`
2. Implement the required methods:
   - `getMetadata()` - Define inputs, outputs, and parameters
   - `generateCode()` - Generate FV-1 assembly code
3. Register your block in `BlockRegistry.ts`

See existing blocks in the following directories for examples:
- `src/blockDiagram/blocks/input/` - Input block examples
- `src/blockDiagram/blocks/output/` - Output block examples
- `src/blockDiagram/blocks/math/` - Math operation examples
- `src/blockDiagram/blocks/effects/` - Effect examples

### Troubleshooting

**Editor doesn't open**
- Ensure the file has the `.spndiagram` extension
- Check that the extension is properly activated

**Blocks don't connect**
- Verify you're connecting an output port to an input port
- Check that the port types are compatible

**Compilation errors**
- Ensure all input and output blocks are properly connected
- Check for cycles in the graph
- Verify all required parameters are set

**Visual issues**
- Try zooming in/out if blocks appear too small/large
- Reset canvas view by reloading the file
