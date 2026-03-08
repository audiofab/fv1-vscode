Frequently Asked Questions
===========================

General Questions
------------------

**Q: Do I need a hardware pedal to use this extension?**

A: No! You can write, test, and export code without hardware. The integrated simulator lets you test effects before deploying to hardware. Hardware is only required if you want to program an actual Easy Spin pedal.

**Q: Can I use both assembly and block diagrams in the same project?**

A: Absolutely! You can mix ``.spn`` assembly files and ``.spndiagram`` block files in the same bank. Create a program bank and add whichever type you prefer to each slot.

**Q: Where can I find the generated assembly code from my block diagram?**

A: Open the ``.spndiagram`` file and click the "View Assembly" button.

**Q: How do I debug my effects?**

A: Use the integrated simulator (``Ctrl+Shift+F9`` from a block diagram or assembly file). Set breakpoints, step through instructions, inspect registers, and visualize signals on the oscilloscope.

**Q: Can I export my programs to use with other FV-1 programmers?**

A: Yes! Use ``Ctrl+Alt+F5`` to export to Intel HEX format. This works with any FV-1 programmer that supports HEX files.

Assembly Programming Questions
--------------------------------

**Q: What FV-1 assembly syntax does this support?**

A: Full FV-1 instruction set from Spin Semiconductor, including all ALU operations, memory access, and control flow. See the hover documentation in the editor for instruction details.

**Q: How do I create custom blocks?**

A: Use the **Assembly Template Language (ATL)**. This declarative format lets you define blocks with JSON metadata and assembly templates. See :doc:`block-developer-guide` for complete documentation.

**Q: What Assembly Template Language (ATL) features are supported?**

A: ATL supports:

- Algebraic syntax (e.g., `@acc = POT0 * 0.5`)
- Preprocessor macros (conditions, calculations)
- Token substitution for pins, registers, and parameters
- Code sections (header, init, main)
- Compiler optimizations

See :doc:`block-developer-guide` for details.

**Q: Can I use external assembly libraries?**

A: Currently, all code must be in single files. Consider creating reusable blocks in ATL for common patterns.

Block Diagram Questions
------------------------

**Q: How many blocks can I add?**

A: Theoretically unlimited, but you're constrained by:

- **128 FV-1 instructions** per program slot
- **32 registers** for temporary storage
- **32,768 words** of delay memory

The extension tracks these in real-time and warns you when limits are approached.

**Q: Can I create custom blocks?**

A: Yes! Custom blocks are defined using **Assembly Template Language (ATL)**. Create a ``.atl`` file to define your block's interface and implementation. See :doc:`block-developer-guide` for the complete guide.

**Q: Why is my connection marked invalid?**

A: Common reasons:

- **Type mismatch**: You're connecting an audio output to a control input (or vice versa)
- **Direction problem**: You're connecting an input to an input (or output to output)
- **Already connected**: The input is already connected to another block
- **Multiple connections to single-input**: Some inputs only accept one connection

Check the error message in the editor for specifics.

**Q: Can I undo a delete?**

A: Yes! Press ``Ctrl+Z`` to undo. You can undo multiple steps if needed.

**Q: How do I organize my blocks better?**

A: Use the lasso selection (``Ctrl+Click`` and drag) to select and move groups of blocks together.

Programming and Hardware
--------------------------

**Q: I programmed my pedal but don't hear the effect. What's wrong?**

A: Try these steps:

1. Rotate the **Program** select switch off and back on your Easy Spin pedal
2. Check that you programmed to the correct slot
3. Verify the effect slot is selected on the front panel
4. Test in the simulator first to confirm the effect works
5. Check the Problems panel for compilation errors

**Q: How do I backup my Easy Spin pedal?**

A: Use the **"FV-1: Backup pedal"** command to save all 8 program slots to an Intel HEX file. This creates a complete backup you can restore later or use with other programmers.

**Q: Can I program multiple slots at once?**

A: Yes! Create a program bank (`.spnbank`) with different programs in each slot, then use the **"Program Bank"** button to deploy all slots at once.

**Q: The programmer isn't detected. What should I do?**

A: 

1. Ensure the **Audiofab USB Programmer** is connected to your Easy Spin pedal
2. Ensure the programmer is connected to your computer via USB
3. Try unplugging and reconnecting both connections
4. Check Device Manager (Windows) or System Report (macOS) to verify the USB connection
5. Restart VS Code
6. Try a different USB port on your computer

**Q: Can I program an Easy Spin without the Audiofab USB Programmer?**

A: The Audiofab extension specifically requires the Audiofab programmer. Other FV-1 boards may have different programming methods.

Simulator Questions
--------------------

**Q: Why is the simulator showing "No Audio Input"?**

A: The simulator needs an audio input stimulus. You can:

- Use the built-in test signals
- Load a custom WAV file
- Connect an audio input or microphone in the simulator's audio settings

**Q: Can I save simulator states or traces?**

A: Currently, no. But you can take screenshots of the oscilloscope for documentation.

**Q: How do I step through my code in the simulator?**

A: Set a breakpoint by clicking on a line in the assembly view, then use the step controls in the simulator panel.

**Q: Can I use the simulator for real-time effects processing?**

A: The simulator is primarily for testing and debugging. For real-time audio effects, program to your Easy Spin pedal.

Performance and Optimization
------------------------------

**Q: My diagram is using too many instructions. How do I optimize?**

A: Try these optimization techniques:

1. **Reduce filter complexity**: Use simpler filters where possible
2. **Combine effects**: Some effects can be simplified or merged
3. **Use algebraic syntax**: In ATL blocks, algebraic syntax generates more efficient code
4. **Eliminate dead outputs**: Disconnect unused outputs on blocks
5. **Review generated assembly**: See what code is being produced

**Q: The extension marks my effect as using too much memory for delay lines.**

A: You've created a delay longer than the available memory. Try:

1. Reducing delay time
2. Reducing number of delay lines
3. Using fewer simultaneous delays

**Q: Can I see how much code each block generates?**

A: Not directly in the UI, but you can:

1. View the generated assembly code
2. Check for compiler optimizations in the Problems panel
3. Monitor resource usage in the status bar

Getting Help
------------

**Q: Where can I find example programs?**

A: Check the `GitHub repository <https://github.com/audiofab/fv1-vscode>`_ for example files and bank templates.

**Q: How do I report a bug?**

A: Open an issue on the `GitHub repository <https://github.com/audiofab/fv1-vscode/issues>`_ with:

- Your VS Code version
- Extension version
- Steps to reproduce
- Expected vs. actual behavior
- Error messages from the Problems panel

**Q: Can I contribute custom blocks?**

A: Yes! See :doc:`block-developer-guide` for the ATL specification, then submit pull requests to the GitHub repository.

**Q: Where's the documentation for ATL (Assembly Template Language)?**

A: See :doc:`block-developer-guide` for comprehensive ATL documentation.

**Q: Is source code available?**

A: Yes, the extension is open-source on `GitHub <https://github.com/audiofab/fv1-vscode>`_.
