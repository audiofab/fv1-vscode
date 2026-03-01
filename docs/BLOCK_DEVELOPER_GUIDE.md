# FV-1 Block Developer Guide

This guide explains how to create new functional blocks for the FV-1 VS Code extension using the **Assembly Template Language (ATL)**.

## Overview

ATL allows you to define blocks declaratively using a combination of JSON metadata and a specialized assembly template. This approach replaces complex TypeScript implementations and makes it easier for developers to contribute new effects.

### File Structure

An ATL block is a single `.atl` file containing:
1.  **JSON Frontmatter**: Metadata about the block (name, category, pins, parameters).
2.  **Assembly Template**: The FV-1 assembly code with dynamic token substitution and preprocessor macros.

```atl
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
```

---

## JSON Metadata Reference

### Core Properties
- `type`: Unique identifier for the block (e.g., `effects.filter.lpf`).
- `name`: Display name in the palette.
- `category`: Grouping in the palette (e.g., `Delay`, `Filter`, `Dynamics`).
- `description`: Tooltip text.
- `color`: Hex color for the block header.
- `width`: Preferred width in the editor (default is 180).

### Pins (`inputs` and `outputs`)
Each pin is an object with:
- `id`: Unique ID used in the assembly template.
- `name`: Label shown on the block.
- `type`: `audio` or `control`.
- `required`: (Input only) If true, the block won't generate code unless connected.

### Parameters
Parameters define the block's adjustable settings in the Property Panel.
- `id`: Used as `${id}` in the template.
- `name`: Label in the UI.
- `type`: `number`, `select`, or `boolean`.
- `default`: Initial value.
- `min`/`max`/`step`: Range for numbers.
- `conversion`: (Optional) Automatically scales UI values to FV-1 coefficients.
  - `LOGFREQ`: 1-pole filter coefficient (Hz → linear).
  - `SVFFREQ`: 2-pole SVF coefficient (Hz → linear).
  - `DBLEVEL`: Decibel to linear gain (dB → linear).
  - `LENGTHTOTIME`: Time to samples (ms → samples).
  - `SINLFOFREQ`: LFO frequency coefficient.

### Memory (`memories`)
Allocates delay line memory.
- `id`: Used as `${mem.id}` in the template.
- `size`: Size in samples (can use a `${parameter_id}` for dynamic sizing).

### Registers (`registers`)
Allocates internal temporary registers.
- `registers`: Array of strings. Use `${reg.id}` in the template.

---

## Assembly Template Features

### Token Substitution
Tokens are replaced at compile time with resolved register names, memory addresses, or parameter values.
- `${input.pin_id}`: The register containing the value for that input.
- `${output.pin_id}`: The register where the output should be written.
- `${reg.reg_id}`: An internal register name.
- `${mem.mem_id}`: A memory address.
- `${parameter_id}`: The resolved/converted value of a parameter.

### Preprocessor Macros

#### Conditional Logic
- `@if pinConnected(pin_id)` / `@else` / `@endif`: Skips code if a pin is not connected.
- `@if isequalto param_id value`: Basic parameter-based logic.

#### Calculations
Use these to pre-calculate constants for your assembly code:
- `@multiplydouble result, a, b`
- `@dividedouble result, a, b`
- `@plusdouble result, a, b`
- `@minusdouble result, a, b`
- `@equals result, value`

#### Code sections
Organize code into separate sections:
- `@section header`: Definitions and constants.
- `@section init`: Code that runs only once (e.g., `WLDS`).
- `@section main`: The main per-sample processing (default).

---

## Tips and Tricks

1.  **Safety First**: Use `rdax ${input.in}, 1.0` instead of `ldax` if you want to sum multiple connections to the same pin (though the extension handles summing for you, it's a good practice).
2.  **Clipping**: FV-1 arithmetic is 1.14 fixed point. Be careful of overflows when summing signals.
3.  **Optimization**: Use `@if pinConnected` to avoid generating assembly for unused outputs or optional modulation inputs.
4.  **Debugging**: Check the compiled `.spn` file side-by-side with your diagram to see exactly what ATL code was generated and how tokens were replaced.
