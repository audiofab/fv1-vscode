FV-1 Block Developer Guide
===========================

This guide explains how to create new functional blocks for the FV-1 VS Code extension using the **Assembly Template Language (ATL)**.

Overview
--------

ATL allows you to define blocks declaratively using a combination of JSON metadata and a specialized assembly template. This approach replaces complex TypeScript implementations and makes it easier for developers to contribute new effects.

File Structure
^^^^^^^^^^^^^^

An ATL block is a single ``.atl`` file containing:

1. **JSON Frontmatter**: Metadata about the block (name, category, pins, parameters).
2. **Assembly Template**: The FV-1 assembly code with dynamic token substitution and preprocessor macros.

Example structure:

.. code-block:: atl

    ---
    {
      "type": "my.effect.id",
      "name": "My Effect",
      "category": "My Category",
      "pins": [...],
      "parameters": [...]
    }
    ---
    ; Assembly code starts here
    rdax ${input.in}, 1.0
    ...


JSON Metadata Reference
-----------------------

Core Properties
^^^^^^^^^^^^^^^

- **type**: Unique identifier for the block (e.g., ``effects.filter.lpf``).
- **name**: Display name in the palette.
- **category**: Grouping in the palette (e.g., ``Delay``, ``Filter``, ``Dynamics``).
- **description**: Tooltip text.
- **color**: Hex color for the block header.
- **width**: Preferred width in the editor (default is 180).
- **labelTemplate**: An expression to dynamically generate the block's label on the canvas based on its parameters or connectedness (e.g., ``${param.mix * 100}%``).

Pins (inputs and outputs)
^^^^^^^^^^^^^^^^^^^^^^^^^

Each pin is an object with:

- **id**: Unique ID used in the assembly template.
- **name**: Label shown on the block.
- **type**: ``audio`` or ``control``.
- **required**: (Input only) If true, the block won't generate code unless connected.

Parameters
^^^^^^^^^^

Parameters define the block's adjustable settings in the Property Panel:

- **id**: Used as ``${id}`` in the template.
- **name**: Label in the UI.
- **type**: ``number``, ``select``, or ``boolean``.
- **default**: Initial value.
- **min/max/step**: Range for numbers.
- **conversion**: (Optional) Automatically scales UI values to FV-1 coefficients.

  - ``LOGFREQ``: 1-pole filter coefficient (Hz → linear).
  - ``SVFFREQ``: 2-pole SVF coefficient (Hz → linear).
  - ``DBLEVEL``: Decibel to linear gain (dB → linear).
  - ``LENGTHTOTIME``: Time to samples (ms → samples).
  - ``SINLFOFREQ``: LFO frequency coefficient.

Memory (memories)
^^^^^^^^^^^^^^^^^

Allocates delay line memory:

- **id**: Used as ``${mem.id}`` in the template.
- **size**: Size in samples (can use a ``${parameter_id}`` for dynamic sizing).

Registers (registers)
^^^^^^^^^^^^^^^^^^^^^

Allocates internal temporary registers:

- **registers**: Array of strings. Use ``${reg.id}`` in the template.


Assembly Template Features
---------------------------

Algebraic Syntax
^^^^^^^^^^^^^^^^

ATL supports an algebraic assignment syntax that automatically translates into FV-1 assembly instructions at compile time, saving you from writing raw ``RDAX``, ``WRAX``, and ``SOF`` statements.

Supported operations include:

**Assignment**
   ``@acc = POT0`` translates to ``RDAX POT0, 1.0``

**Math/Scaling**
   ``@acc = ${reg.f1} * 0.5`` translates to ``RDAX REG_f1, 0.5``

**Output Storage**
   ``${output.out} = @acc`` translates to ``WRAX OUT, 0.0``

**Accumulation**
   ``@acc += POT1`` translates to ``RDAX POT1, 1.0``

**Bitwise Logic**
   ``@acc &= 0.9`` translates to ``AND 0.9``

**Scale Off-Set (SOF)**
   ``@acc = @acc * 0.2 + 0.1`` translates to ``SOF 0.2, 0.1``

**Filtering**
   - ``lpf`` (Low Pass / ``WRAX``)
   - ``hpf`` (High Pass / ``WRHX``)
   - ``lpf_alt`` (Shelving / ``WRLX``)
   - ``lpf_modulated`` (Envelope control / ``MULX``)

   Example: ``@acc = lpf(${reg.state}, POT0, 0.5)`` translates to ``RDFX REG_state, POT0`` and ``WRAX REG_state, 0.5``.

   **Note:** If assigning to a register instead of ``@acc``, the compiler automatically passes ``0.0`` as the scale to clear the accumulator.

**Static Math Parsing**
   The compiler parses pure mathematical statements like multiplication, addition, and grouping parentheses before serializing to FV-1 instructions. For example, expressions composed only of parameter literals, such as ``@acc = @acc * (${param.max} - ${param.min}) + ${param.min}``, are algebraically folded into single floats at compile time safely handling Scale Offsets (``SOF``).

.. note::
   Algebraic syntax must be cleanly formatted. If the compiler encounters a malformed math operation (e.g., ``POT0 + * 2``), it will generate a compile-time syntax error displayed directly in the VS Code Problems pane.

Compiler Optimizations
^^^^^^^^^^^^^^^^^^^^^^

The ATL compiler doesn't just blindly concatenate assembly; it also runs a multi-stage optimization pass to produce highly efficient FV-1 code:

- **Algebraic Folding**: Static mathematical expressions are resolved into single floats during compilation.
- **Dead Output Elimination**: If an output pin is left unconnected in the block diagram, the compiler automatically skips generating the assembly for calculating and writing that output (when safely possible), preserving DSP cycles.
- **Disconnected Output Pruning**: Output ports with no downstream connection never allocate a physical register at all. This means blocks with many optional outputs (e.g., crossovers, multi-band processors) don't waste register space on unused paths.
- **Accumulator Forwarding**: Redundant write-then-read steps (e.g., ``WRAX reg, 0.0`` immediately followed by ``RDAX reg, 1.0``) are collapsed into a single ``WRAX reg, 1.0`` instruction to conserve instruction slots.
- **Move Pruning**: Trims redundant register moves (such as unnecessary ``WRAX`` → ``LDAX`` sequences).
- **Dead Store Elimination** (Level 2): Identifies ``WRAX`` instructions whose target register is never subsequently read and eliminates them entirely, reclaiming both instruction slots and registers.
- **Auto-Clearing**: Automatically injects ``CLR`` instructions when leaving input stages if the accumulator is left dirty, ensuring no bleed-over between unconnected audio blocks.
- **Register Renumbering**: After all optimization passes complete, surviving register EQU declarations are compacted sequentially from ``REG0`` upward. This eliminates numbering gaps left by pruned registers and guarantees a minimal register footprint.

.. note::
   Register limits are enforced **after** all optimization passes, not during code generation. This means your block can safely allocate internal registers without worrying about premature "out of registers" errors — the optimizer will prune dead stores first and only then check whether the surviving register count fits within the hardware limit.

Token Substitution
^^^^^^^^^^^^^^^^^^

Tokens are replaced at compile time with resolved register names, memory addresses, or parameter values:

- ``${input.pin_id}``: The register containing the value for that input.
- ``${output.pin_id}``: The register where the output should be written.
- ``${reg.reg_id}``: An internal register name.
- ``${mem.mem_id}``: A memory address.
- ``${parameter_id}``: The resolved/converted value of a parameter.

Preprocessor Macros
^^^^^^^^^^^^^^^^^^^

Conditional Logic
"""""""""""""""""

- ``@if`` / ``@else`` / ``@endif`` blocks allow for flexible template generation based on active input states or parameters.

**Pin Connections**
   ``@if pinConnected(pin_id)`` skips code if the specified pin identifier is unconnected in the visual schematic.

**Operations & Logic**
   ``@if param_id >= 10.0`` enables testing properties explicitly natively. Numeric tests are strictly equivalent matching, falling back safely to strings where variables like ``"invert"`` are tested against boolean primitives (e.g., ``@if ${param.invert} == true``).

**Compound Checks**
   ``@if`` naturally handles chained logical ``&&`` (AND) and ``||`` (OR) separators (e.g., ``@if ${param.x} == 1 || ${param.y} != 0``).

**Compile-Time Assertions**
   Use ``@assert condition, "Error Message"`` to forcibly abort compilation and bubble an error message into VS Code if a user configures a block incorrectly (e.g., ``@assert ${param.max} > ${param.min}, "Max must be greater than Min!"``).

Calculations & Special Macros
"""""""""""""""""""""""""""""

Use these to pre-calculate constants for your assembly code or invoke built-in hardware behaviors dynamically:

- ``@equals result, value``: Evaluate expression and assign to variable identifier.
- ``@multiplydouble result, a, b`` / ``@dividedouble`` / ``@plusdouble`` / ``@minusdouble``: Math evaluated statically against parameters.

Control Voltage (CV) Macros
"""""""""""""""""""""""""""

When building blocks with modulation or control inputs, use these macros to seamlessly load signals into the accumulator while automatically handling unconnected limits, parameter scaling, and the **Zero Bypass** (Ignore if Zero) potentiometer feature. Your parameter JSON must specify an associated ``parameter`` (e.g. ``"parameter": "mix"``) for these to work.

- ``@cv pin_id``: Flushes the accumulator and loads the CV value. If the pin is unconnected, it loads the raw parameter constant. If connected to a Pot with Zero Bypass enabled, it will seamlessly jump to the user's bypass value when tracking below 1%.
- ``@mulcv pin_id``: Multiplies the existing value in the accumulator by the CV value. Supports the same fallback and Zero Bypass scaling natively without corrupting the signal you are scaling.

Code Sections
"""""""""""""

Organize code into separate sections:

- ``@section header``: Definitions and constants.
- ``@section init``: Code that runs only once (e.g., ``WLDS``).
- ``@section main``: The main per-sample processing (default).

Custom Blocks
-------------

The extension allows you to develop and use your own custom blocks alongside the built-in library. This is the fastest way to extend the system with your own DSP algorithms.

Copying Existing Blocks
^^^^^^^^^^^^^^^^^^^^^^^

The easiest way to start writing a new block is to use an existing one as a template:

1. Open a block diagram (``.spndiagram``).
2. Right-click any block on the canvas.
3. Select **"Copy ATL Source"** from the context menu.
4. The raw ATL (metadata and assembly) is now in your clipboard. You can paste this into a new ``.atl`` file and modify it.

Custom Block Paths
^^^^^^^^^^^^^^^^^^

To make your own blocks appear in the editor's palette:

1. Create a directory on your computer to store your ``.atl`` files.
2. Open VS Code Settings (``Ctrl+,``).
3. Search for ``fv1.customBlockPaths``.
4. Add the **absolute path** to your custom blocks directory. You can add multiple paths if needed.

.. note::
   The extension searches these directories recursively for any file ending in ``.atl``.

Refreshing the Registry
^^^^^^^^^^^^^^^^^^^^^^^

After you've added new ``.atl`` files or modified existing ones in your custom paths, you need to tell the extension to reload them:

1. Open the Command Palette (``Ctrl+Shift+P``).
2. Run the command **"FV-1: Refresh Custom Blocks"**.
3. The block registry will be reloaded, and any open block diagrams will immediately update to show the new or changed blocks in the palette.

Tips and Tricks
---------------

1. **Safety First**: Use ``rdax ${input.in}, 1.0`` instead of ``ldax`` if you want to sum multiple connections to the same pin (though the extension handles summing for you, it's a good practice).

2. **Clipping**: FV-1 arithmetic is 1.14 fixed point. Be careful of overflows when summing signals.

3. **Optimization**: Use ``@if pinConnected`` to avoid generating assembly for unused outputs or optional modulation inputs.

4. **Enforce Parameters**: Extensively use ``@assert`` blocks at the top of routines to explicitly warn users of bad parameter states inside the VS Code Problems UI.

5. **Debugging**: Check the compiled ``.spn`` file side-by-side with your diagram to see exactly what ATL code was generated and how tokens were replaced.

6. **Writing New Blocks**: Creating a block follows a simple lifecycle:
   
   - Define the required nodes inside its JSON frontmatter to inform the palette
   - Configure the internal math algebraically
   - Handle user boundary configuration with ``@if``/``@assert``
   - Connect its visual nodes functionally with ``${input.foo}`` tokens
   - Validate logic changes frequently via ``npm test``

Example: Creating a Simple Gain Block
--------------------------------------

Here's a minimal example to get you started:

.. code-block:: atl

    ---
    {
      "type": "gain.simple",
      "name": "Volume",
      "category": "Gain/Mixing",
      "description": "Simple gain adjustment",
      "color": "#FF6B6B",
      "inputs": [
        {"id": "in", "name": "In", "type": "audio", "required": true}
      ],
      "outputs": [
        {"id": "out", "name": "Out", "type": "audio"}
      ],
      "parameters": [
        {
          "id": "gain",
          "name": "Gain",
          "type": "number",
          "default": 1.0,
          "min": 0.0,
          "max": 2.0,
          "step": 0.01,
          "conversion": "DBLEVEL"
        }
      ],
      "registers": ["acc"]
    }
    ---
    @acc = ${input.in} * ${param.gain}
    ${output.out} = @acc

Contributing Back
-----------------

Found a useful block or optimization? Consider contributing it back to the project:

1. Add your ``.atl`` block to the appropriate folder in ``resources/blocks/``
2. Add test cases in ``test/blocks/`` if applicable
3. Run ``npm test`` to validate
4. Submit a pull request on `GitHub <https://github.com/audiofab/fv1-vscode>`_

See the :doc:`faq` for more information about contributing custom blocks.
