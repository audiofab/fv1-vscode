# Developer's Guide: Creating New Blocks for Audiofab FV-1

This guide explains how to extend the FV-1 Block Diagram editor by creating custom functional blocks using the **Audiofab Template Language (ATL)**.

## Architecture Overview
New blocks are **declarative**. Instead of writing complex TypeScript classes, you define your block in a simple JSON or YAML file. The core engine handles resource allocation, register management, and code optimization automatically.

### Block Structure
A block definition consists of four main sections:
1. **Metadata**: Identity and visual appearance.
2. **Ports**: Audio and control connections.
3. **Parameters**: User-adjustable settings (knobs, switches).
4. **Logic (Template)**: The assembly code with dynamic placeholders.

---

## 1. Metadata & Logic (The .atl Format)
Definitions are stored in `resources/blocks/*.atl`. They use a **Frontmatter** format: YAML/JSON metadata at the top, and pure assembly code at the bottom.

```yaml
---
{
  "type": "my_filter",
  "name": "Super Filter",
  "category": "Filters",
  "color": "#FF5722",
  "inputs": [
    { "id": "in1", "name": "Input", "type": "audio" }
  ],
  "outputs": [
    { "id": "out", "name": "Filtered", "type": "audio" }
  ]
}
---
; Assembly starts here
rdax ${input.in1}, 1.0
mulx ${param.cutoff}
wrax ${output.out}, 0
```

---

## 2. Parameters & Conversions
Parameters bridge the gap between user-friendly values and FV-1 coefficients.

### Modern Conversion Primitives
Use functional naming for automatic math:
- `hzToCoeff(hz)`: Mapped to a 1-pole filter coefficient.
- `hzToLfoRate(hz)`: Mapped to SIN/COS LFO rates.
- `dbToGain(db)`: Mapped to a linear multiplier.
- `msToSamples(ms)`: Mapped to delay memory indices.

```json
"parameters": [
  {
    "id": "cutoff",
    "name": "Frequency (Hz)",
    "type": "number",
    "min": 20, "max": 20000, "default": 1000,
    "conversion": "hzToCoeff"
  }
]
```

---

## 3. The ATL Template
The template is standard SpinASM code enhanced with powerful directives:

### Variables
- `${param.cutoff}`: The pre-calculated coefficient.
- `${input.in1}`: The register containing the input signal.
- `${output.out}`: The register where the output should be written.

### Control Flow & Sections
```asm
@section init
  ; This code runs only once at startup
  wlds SIN0, 10, 50

@section main
  ; This code runs in the DSP loop
  rdax ${input.in1}, 1.0
  ...
```

The `@section` directive ensures that code from different blocks is correctly interleaved in the final output (e.g., all `init` sections from all blocks are grouped together at the top of the program).

### Variable Substitution
- `${param.cutoff}`: The pre-calculated coefficient.
You don't need to worry about efficiency between blocks. The compiler performs **Move Pruning**:
- If Block A writes `wrax reg1, 0` and Block B starts with `ldax reg1`, the compiler will automatically omit the `ldax` and use the value already in the accumulator.
- **Tip**: Always finish your logic by leaving your main result in the accumulator; the compiler will handle the rest.

## 5. Converting from SpinCAD
If you have a `.spincad` file, use the built-in converter:
`node convert-spincad-standalone.js`

This will automatically translate legacy directives like `@readChorusTap` into ATL-compatible assembly.
