Getting Started
===============

Creating Your First Block Diagram
----------------------------------

Block diagrams provide a visual way to create effects without writing assembly code. Here's how to get started:

1. Open the **Quick Actions** sidebar
   
   - Click the Audiofab icon in the VS Code Activity Bar on the left

2. Click **"Create New Block Diagram"**

3. Choose a location and filename for your diagram

4. Drag blocks from the palette onto the canvas

5. Connect blocks by:
   
   - Clicking an output port on one block
   - Dragging to an input port on another block

6. Modify block parameters by clicking a block and changing values in the Properties panel

7. Program to your pedal or export to HEX:
   
   - ``Ctrl+Shift+F5`` to program to the current slot
   - ``Ctrl+Alt+F5`` to export to Intel HEX format

.. image:: _static/images/visual_editor.png
   :alt: Visual Block Diagram Editor
   :align: center

.. note::
   After programming, ensure you rotate the **Program** select switch off of the current program and back to have the FV-1 reload the new program contents from EEPROM.

Creating Your First Program Bank
---------------------------------

Organize multiple programs (assembly or block diagrams) into a bank of 8 slots:

1. Open the **Quick Actions** sidebar

2. Click **"Create New Program Bank"**

3. Choose a location and filename

4. Drag ``.spn`` or ``.spndiagram`` files from the File Explorer onto bank slots

5. Click the **"Program Bank"** button to load all programs to your pedal

Assembly Programming
--------------------

If you prefer traditional FV-1 assembly language:

1. Create a new ``.spn`` file (right-click in Explorer → New File)

2. The extension provides syntax highlighting and real-time diagnostics

3. Use ``Ctrl+Shift+F5`` to assemble and program to your pedal

4. See the :ref:`assembly-syntax` guide for language reference

Using the Simulator
-------------------

Test your effects without hardware:

1. Open a block diagram or assembly file

2. Click the **"Launch Simulator"** button (or press ``Ctrl+Shift+F9`` with the file open)

3. The simulator opens with:
   
   - **Audio Monitor**: Hear your effect in real-time
   - **Oscilloscope**: Visualize any register or signal
   - **Delay Memory Map**: See delay buffer usage
   - **Controls**: Adjust POT0, POT1, POT2 in real-time
   - **Breakpoints**: Debug by stepping through instructions

Tips for Success
----------------

- **Start simple**: Begin with a single effect block and gradually add complexity
- **Monitor resources**: Watch the status bar for instruction, register, and memory usage
- **Use the simulator**: Always test in simulation before programming hardware
- **Check the error list**: VS Code's Problems panel shows compilation errors
- **Explore examples**: Look at the block library to see how complex effects are built
- **Save often**: Use ``Ctrl+S`` to save your work regularly

Next Steps
----------

- Read about available :doc:`features`
- Check :doc:`commands` for keyboard shortcuts
- Explore the :doc:`block-developer-guide` if you want to create custom blocks
- See the :doc:`faq` for common questions
