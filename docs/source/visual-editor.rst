Visual Block Diagram Editor
=============================

The visual block diagram editor allows you to create complex FV-1 effects by dragging and connecting functional blocks without writing assembly code.

Editor Features
---------------

**Parameters Panel**
   Click on a block to view and modify its parameters in the right panel. Changes apply immediately with live compilation and instant feedback.

**Lasso Selection**
   ``Ctrl+Click`` and drag on empty canvas to select multiple blocks at once. This is useful for moving groups of blocks together.

**Multi-Select Operations**
   Hold ``Ctrl`` and click multiple blocks to add them to your selection. Delete selected blocks and connections with ``Delete``.

**Pan and Zoom**
   - **Pan**: Click and drag on empty canvas (not on a block) to move your view
   - **Zoom**: Use mouse wheel to zoom in and out

**Undo/Redo**
   - Press ``Ctrl+Z`` to undo your last action
   - Press ``Ctrl+Shift+Z`` or ``Ctrl+Y`` to redo

**Connection Validation**
   The editor prevents invalid connections ande xplains why the connection is invalid

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
   Modify signals with potentiometers, smoothing, curves, and tremolo effects. 
   
   *Zero Bypass Feature (Ignore if Zero)*: Potentiometer blocks have a special setting called "Ignore if Zero". When enabled, you can provide a "Zero Bypass Value". When the physical potentiometer is turned all the way down, the control voltage automatically falls back to this specified bypass value instead of 0. This is extremely useful for parameters like Mix or Delay Time where the "zero" knob position should default to a mathematically pure state (e.g. 100% dry, or fully bypassing an effect path) rather than exactly `0.0`. The main use case is for configuring presets that you can switch to and know exactly where the controls will be set by default (so long as you turn the pots all the way down), while still having the flexibility to adjust them live if you want.

**Gain/Mixing Blocks**
   Mix multiple signals together, add gain or adjust volume levels.

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
   Toggle switches for on/off options (e.g., invert).

Parameter values can often be connected to control inputs for real-time modulation. Check individual block documentation for details.

Resource Indicators
-------------------

As you build your diagram, watch the status bar at the bottom of VS Code:

- **Instructions**: Shows how many of 128 instruction slots are used
- **Registers**: Shows how many of 32 registers are used
- **Delay Memory**: Shows how many of 32,768 memory words are used
- **LFOs**: Shows how many of the four available LFOs are used

If you exceed any limit, you'll see a warning in the Problems panel.

Code Optimization
------------------

The extension automatically optimizes generated code at multiple levels of aggressiveness:

**Level 0 (None)**: All blocks remain isolated with no cross-block optimizations

**Level 1 (Standard)**: 
   - Dead Code Elimination: Unused outputs don't generate code
   - Accumulator Forwarding: Redundant register operations are collapsed
   - Register Pruning: Unnecessary register moves are trimmed

**Level 2 (Aggressive)**:
   - Includes all Level 1 optimizations
   - Dead Store Elimination: Removes ``wrax`` instructions whose registers are never read
   - Section Flattening: Collapses Input/Main/Output sections into optimized topological order

Configure the optimization level with the ``fv1.optimizationLevel`` setting (0, 1, or 2). Higher levels produce smaller code but may be harder to debug.

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

Example: Creating a Simple Reverb
---------------------------------

Here's a typical workflow:

1. Add an **Input** block (ADC)
2. Add one of the **Reverb** effect blocks
3. Add a **Mixer** or **Crossfade** block to blend wet and dry signals
4. Add an **Output** block (DAC)
5. Connect: Input → Reverb → Mix → Output
6. Adjust reverb parameters using the Properties panel
7. Press ``Ctrl+Shift+P`` and then select "FV-1: Run In Simulator" to simulate, or "FV-1: Assemble current file and load to EEPROM" to load to a slot in your pedal

Next Steps
----------

- See :doc:`commands` for available commands and keyboard shortcuts
- See :doc:`/simulator` for information on how to use the debugger and simulator
- Check :doc:`block-developer-guide` if you want to create your own custom blocks
