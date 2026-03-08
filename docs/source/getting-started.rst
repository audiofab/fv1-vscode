Getting Started
===============

Creating Your First Block Diagram
----------------------------------

Block diagrams provide a visual way to create effects without writing assembly code. Here's how to get started:

1. Open the **Quick Actions** sidebar
   
   - Click the Audiofab icon in the VS Code Activity Bar on the left

.. image:: _static/images/quick_actions.png
   :alt: Quick Actions Sidebar
   :align: center

2. Click **"New Block Diagram"**

3. Choose a location and filename for your diagram

4. Drag blocks from the palette onto the canvas

.. image:: _static/images/block_diagram_example1.png
   :alt: Visual Block Diagram Editor
   :align: center

5. Connect blocks by:
   
   - Clicking an output port on one block
   - Dragging to an input port on another block


6. Modify block parameters by clicking a block and changing values in the Properties panel

7. Program to your pedal or export to HEX:
   
   - Press ``Ctrl+Shift+P`` and select "FV-1: Assemble current file and load to EEPROM" to program to your Easy Spin pedal
   - Press ``Ctrl+Shift+P`` and select "FV-1: Assemble current file to an Intel HEX file" to save an Intel HEX file

.. note::
   After programming, ensure you rotate the **Program** select switch off of the current program and back to have the FV-1 reload the new program contents from EEPROM.

Creating Your First Program Bank
---------------------------------

You can organize multiple programs (assembly or block diagrams) into a bank of 8 slots:

1. Open the **Quick Actions** sidebar

2. Click **"New Program Bank"**

3. Choose a location and filename

4. Drag ``.spn`` or ``.spndiagram`` files from the File Explorer onto bank slots

5. Click the **"Program Bank"** button to load all programs to your pedal

Assembly Programming
--------------------

If you prefer traditional FV-1 assembly language:

1. Create a new ``.spn`` file (right-click in Explorer → New File)

2. The extension provides syntax highlighting and real-time diagnostics

3. Use ``Ctrl+Shift+P`` and select "FV-1: Assemble current file and load to EEPROM" to program to your Easy Spin pedal

Using the Simulator
-------------------

Test your effects without hardware:

1. Open a block diagram or assembly file

2. Click the **"Simulate"** button in the block diagram editor or press ``Ctrl+Shift+P`` and select "FV-1: Run In Simulator"

3. The simulator provide the following features:
   
   - **Audio Monitor**: Hear your effect in real-time
   - **Oscilloscope**: Visualize any register or signal
   - **Spectrogram**: Visualize the frequency spectrum of the FV-1 outputs
   - **Delay Memory Map**: See delay buffer usage
   - **Controls**: Adjust POT0, POT1, POT2 in real-time
   - **Breakpoints**: Debug by stepping through instructions

Tips for Success
----------------

- **Start simple**: Begin with a single effect block and gradually add complexity
- **Monitor resources**: Watch the status bar for instruction, register, delay memory and LFO usage
- **Use the simulator**: Always test in simulation before programming hardware
- **Check the error list**: VS Code's Problems panel shows compilation errors

Next Steps
----------

- Read about available :doc:`features`
- Check the :doc:`commands`
- Learn how to use the :doc:`visual-editor`
- Explore the features available in the :doc:`simulator`
- Explore the :doc:`block-developer-guide` if you want to create custom blocks
- See the :doc:`faq` for common questions
