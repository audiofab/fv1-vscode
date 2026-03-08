Commands Reference
===================

Open the Command Palette with ``Ctrl+Shift+P`` (Windows/Linux) or ``Cmd+Shift+P`` (macOS) to access these commands:

Assembly File Commands (.spn)
-----------------------------

**FV-1: Assemble current file**
   Compile and check for errors. Errors are displayed in the Problems panel.
   Note: This runs automatically in the background anyway.

**FV-1: Assemble current file and load to EEPROM**
   Compile your assembly and program it to your Easy Spin pedal.
   
   Keyboard shortcut: ``Ctrl+Shift+F5``

**FV-1: Assemble current file to an Intel HEX file**
   Export your compiled assembly to Intel HEX format for backup or use with other programmers.
   
   Keyboard shortcut: ``Ctrl+Alt+F5``


Block Diagram Commands (.spndiagram)
-------------------------------------

**FV-1: Assemble current file and load to EEPROM**
   Compile your diagram to assembly, assemble it, and program to your pedal.
   
   Keyboard shortcut: ``Ctrl+Shift+F5``

**FV-1: Assemble current file to an Intel HEX file**
   Compile and export your block diagram to Intel HEX format.
   
   Keyboard shortcut: ``Ctrl+Alt+F5``


Intel HEX Commands (.hex)
--------------------------

**FV-1: Load HEX to EEPROM**
   Program an Intel HEX file directly to your Easy Spin pedal.
   
   Keyboard shortcut: ``Ctrl+Shift+F6``


Utility Commands
----------------

**FV-1: Backup pedal**
   Save the entire EEPROM contents of your Easy Spin pedal (all 8 program slots) to an Intel HEX file.
   This creates a complete backup of all your programs on the hardware.

**FV-1: Create `.spnbank`**
   Create a new program bank file to organize multiple programs into the 8 available slots.

**FV-1: Create new block diagram**
   Create a new visual block diagram file (`.spndiagram`).


Block Diagram Editor Shortcuts
-------------------------------

When editing a block diagram, use these keyboard shortcuts:

**Navigation**
   - **Pan**: Click and drag on empty canvas
   - **Zoom In**: Mouse wheel up or ``Ctrl+Plus``
   - **Zoom Out**: Mouse wheel down or ``Ctrl+Minus``
   - **Fit View**: ``Ctrl+0`` (zero)

**Selection and Editing**
   - **Select Block**: Click on a block
   - **Multi-Select**: ``Ctrl+Click`` on blocks to add to selection
   - **Lasso Select**: ``Ctrl+Click`` and drag on empty canvas to select multiple blocks
   - **Delete**: ``Delete`` or ``Backspace`` to remove selected blocks and connections

**Undo/Redo**
   - **Undo**: ``Ctrl+Z``
   - **Redo**: ``Ctrl+Shift+Z`` or ``Ctrl+Y``

**Properties**
   - Click on a block to show its parameters in the Properties panel
   - Modify parameter values to configure the block

**Connections**
   - Click an **output port** (right side of a block) and drag to an **input port** (left side) to create a connection
   - Invalid connections are automatically rejected with helpful error messages
   - A **green check** indicates valid connections
   - A **red X** indicates invalid connections


Tips
----

- Use ``Ctrl+Shift+F5`` for quick programming — it's the most common shortcut
- Many commands are context-sensitive and only appear in the Command Palette when appropriate files are open
- Hover over commands in the Command Palette to see their keyboard shortcuts
- Check the status bar for real-time resource usage feedback while editing diagrams
