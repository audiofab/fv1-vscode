Visual Block Diagram Editor
=============================

The visual block diagram editor allows you to create complex FV-1 effects by dragging and connecting functional blocks without writing assembly code.

Editor Features
---------------

**Parameters Panel**
   Click on a block to view and modify its parameters in the right panel. Changes apply immediately with live compilation feedback.

**Lasso Selection**
   ``Ctrl+Click`` and drag on empty canvas to select multiple blocks at once. This is useful for moving groups of blocks together.

**Multi-Select Operations**
   Hold ``Ctrl`` and click multiple blocks to add them to your selection. Delete selected blocks and connections with ``Delete`` or ``Backspace``.

**Pan and Zoom**
   - **Pan**: Click and drag on empty canvas (not on a block) to move your view
   - **Zoom**: Use mouse wheel to zoom in and out
   - **Fit to View**: Press ``Ctrl+0`` to fit all blocks in the current view

**Undo/Redo**
   - Press ``Ctrl+Z`` to undo your last action
   - Press ``Ctrl+Shift+Z`` or ``Ctrl+Y`` to redo

**Connection Validation**
   The editor prevents invalid connections and shows:
   
   - **Green Check** (✓): Valid connection
   - **Red X** (✗): Invalid connection
   - **Error Message**: Explains why the connection is invalid

Creating Blocks and Connections
--------------------------------

1. **Add a Block**
   
   Drag a block from the palette on the left onto the canvas.

2. **Connect Blocks**
   
   a. Click an **output port** (right side of a block)
   b. Drag to an **input port** (left side) of another block
   c. Release to create the connection

3. **Configure Parameters**
   
   Click a block to select it and modify parameters in the Properties panel.

4. **Delete Connections**
   
   Click on a connection line and press ``Delete``, or select both blocks and press ``Delete``.

Block Types
-----------

**Input Blocks**
   Route audio from the hardware ADC to your signal processing chain.

**Output Blocks**
   Route processed audio to the hardware DAC.

**Control Blocks**
   Modify signals with smoothing, curves, and tremolo effects.

**Gain/Mixing Blocks**
   Mix multiple signals together or adjust volume levels.

**Filter Blocks**
   Apply low-pass, high-pass, or shelf filters.

**Effect Blocks**
   Apply complex effects like delays, reverbs, choruses, and flangers.

**Other Blocks**
   Utilities like tone generators and utility blocks.

Parameters and Configuration
-----------------------------

Each block type has specific parameters that you can adjust:

**Number Parameters**
   Presented as sliders or text input fields. Use the slider for quick adjustments or type for precise values.

**Selection Parameters**
   Choose from a dropdown list of predefined options (e.g., filter types).

**Boolean Parameters**
   Toggle switches for on/off options (e.g., invert, enable modulation).

Parameter values can often be connected to control inputs for real-time modulation. Check individual block documentation for details.

Resource Indicators
-------------------

As you build your diagram, watch the status bar at the bottom of VS Code:

- **Instructions**: Shows how many of 128 instruction slots are used
- **Registers**: Shows how many of 32 registers are used
- **Delay Memory**: Shows how many of 32,768 memory words are used

If you exceed any limit, you'll see a warning in the Problems panel.

Code Optimization
------------------

The extension automatically optimizes generated code:

- **Dead Code Elimination**: Unused outputs don't generate code
- **Accumulator Forwarding**: Redundant register operations are collapsed
- **Move Pruning**: Unnecessary register moves are trimmed
- **Auto-Clearing**: Proper register cleanup between processing stages

This means your diagrams typically generate highly efficient code that uses fewer instruction slots than manual assembly.

Tips for Effective Diagrams
----------------------------

**Start Simple**
   Begin with single-effect chains and gradually add complexity.

**Monitor Resources**
   Keep an eye on the resource indicators in the status bar.

**Use Parameters**
   Take advantage of block parameters to shape your effect without additional code.

**Test in Simulator**
   Always test in the integrated simulator before programming hardware.

**Optimize Layout**
   Arrange blocks left-to-right for signal flow: inputs on the left, outputs on the right.

**Use Comments**
   While the visual editor doesn't have comment blocks, well-organized layouts are self-documenting.

**Save Frequently**
   Use ``Ctrl+S`` to save your work regularly.

Programming Your Diagram
-------------------------

Once you've created your diagram:

1. **Program to Pedal**: ``Ctrl+Shift+F5`` to program to the current slot
2. **Export to HEX**: ``Ctrl+Alt+F5`` to save as Intel HEX
3. **View Assembly**: Right-click the file → "View Generated Assembly" to see the FV-1 code

.. note::
   After programming your Easy Spin pedal, rotate the **Program** select switch off of the current program and back to load the new program from EEPROM.

Example: Creating a Simple Reverb
---------------------------------

Here's a typical workflow:

1. Add an **Input** block (ADC)
2. Add one or more **Reverb** effect blocks
3. Add a **Mix** block to blend wet and dry signals
4. Add an **Output** block (DAC)
5. Connect: Input → Reverb → Mix → Output
6. Adjust reverb parameters using the Properties panel
7. Press ``Ctrl+Shift+F5`` to program to your pedal

Next Steps
----------

- See :doc:`commands` for keyboard shortcuts reference
- Learn about individual block types in the block palette
- Check :doc:`block-developer-guide` if you want to create custom blocks
- Read :doc:`getting-started` for more tutorials
