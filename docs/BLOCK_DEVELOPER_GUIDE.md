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

### Control Flow
ATL supports conditional code generation based on the state of the block diagram:

```asm
@if pinConnected(freq_ctrl)
  ; Code when frequency control is connected
  rdax ${input.in}, ${param.frequency}
  mulx ${input.freq_ctrl}
@else
  ; Code when frequency is fixed
  rdfx ${output.out}, ${param.frequency}
@endif
```

### High-Level DSP Macros (Audiofab Standard Library)
To avoid boiler-plate assembly, use high-level directives. The compiler handles the best implementation automatically.

- `@lpf1p result, input, freq [, ctrl]`: Single-pole low-pass filter.
- `@hpf1p result, input, freq [, ctrl]`: Single-pole high-pass filter.
- `@lfo type, freqHz, rangeMs`: Configuration for LFOs (SIN0, SIN1, COS0, COS1).
- `@smooth result, input, coeff`: RDFX-based smoothing for control signals.
- `@gain result, input, gain`: Simple multiplier.

**Example using Macros:**
```asm
; A complete LPF with optional modulation in one line
@lpf1p ${output.out}, ${input.in1}, ${param.frequency}, ${input.freq_ctrl}
```

---

## 4. Code Optimization
You don't need to worry about efficiency between blocks. The compiler performs **Move Pruning**:
- If Block A writes `wrax reg1, 0` and Block B starts with `ldax reg1`, the compiler will automatically omit the `ldax` and use the value already in the accumulator.
- **Tip**: Always finish your logic by leaving your main result in the accumulator; the compiler will handle the rest.

## 5. Converting from SpinCAD
If you have a `.spincad` file, use the built-in converter:
`node convert-spincad-standalone.js`

The converter identifies legacy patterns and translates them into modern ATL directives where possible. For example, legacy `@readChorusTap` patterns are converted to modern `@chorusRead` or equivalent assembly blocks.
