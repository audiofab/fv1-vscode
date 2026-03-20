# ATL (Audiofab Template Language) Block Development Reference

This document serves as the foundational context and ruleset for creating high-quality FV-1 algorithms as ATL blocks in the FV-1 VS Code Extension.

## 1. File Structure Overview
Each `.atl` file must consist of two main parts separated by `---`:
1. **JSON Configuration Module**: Defines block metadata, inputs, outputs, parameters, memories, and hardware registers.
2. **ATL Code Module**: Contains the FV-1 DSP assembly mixed with ATL macros and directives.

## 2. Parameter Conversions
All parameters should be explicitly mapped using proper conversions. Use the `conversion` key in the parameter JSON.
- **Gain**: Use `"conversion": "DBLEVEL"` (UI shows dB, code gets linear).
- **Delay Times**: Use `"conversion": "MS_TO_SAMPLES"` (UI shows ms, code gets sample count).
- **Frequencies / Rates**: Use `"conversion": "HZ_TO_LFO_RATE"` for LFOs, `"conversion": "LOGFREQ"` for filters.
- **LFO Width**: Use `"conversion": "MS_TO_LFO_RANGE"`.

## 3. Fallbacks for Control Inputs
Every control input must have a corresponding "fallback" strategy when the input pin is NOT connected by the user.
Use the `@if pinConnected(input_id)` directive to switch between CV logic and static parameter logic:

```assembly
@if pinConnected(mixCV)
rdax ${input.mixCV}, 1.0
mulx ${input.mixCV}
@else
@multiplydouble mixSq ${mix}, ${mix}
sof 0.0, ${mixSq}
@endif
```

## 4. Input Connection Safeguards
If the block's main audio input pin is completely disconnected, the block should generally produce no instructions, or handle the bypass effectively, avoiding generating useless cycles.

```assembly
@section main
@if pinConnected(input)
  ; ... heavy processing ...
@else
  ; Block disabled / bypassed
@endif
```

## 5. Memory Management
Delay block memory allocations MUST be explicitly placed in the `"memories"` JSON array.
- A fixed size: `{ "id": "pdel", "size": 3276 }`
- Bound to a parameter (e.g., `delayLength` converted by `MS_TO_SAMPLES`): `{ "id": "delayl", "size": "delayLength" }`

In code, reference these with `${mem.pdel}` or `${mem.delayl}`.
- To access base address: `${mem.id}`
- To access fractional taps or offset taps: `${mem.id} + offset`

## 6. Registers
All registers used by the block must be declared in the `"registers"` JSON array. 
Reference them via `${reg.registryName}`. No magic EQU offsets/allocations should be done manually for registers.
Example: `"registers": ["wet", "dry", "temp"]`

## 7. Magic Numbers & Reusability
Avoid magic constants scattered throughout the assembly. Declare them using `@equals` in an `@section header`.
```assembly
@section header
@equals decayLimit 0.8
@equals bandwidth 0.31852
```
To calculate derived parameters, use `EQU` formulas if needed, e.g.:
```assembly
EQU tap1 (0.9 * ${tap1Center} * ${delayLength})
```

## 8. Routing / I/O Defaults
If left and right outputs exist, verify which are connected to prevent writing to address zero (`ADDR_PTR` trick or just skipping) if the output isn't used:
```assembly
@if pinConnected(outL)
wrax ${output.outL}, 0.0
@else
wrax ADDR_PTR, 0.0 ; discard
@endif
```

## 9. Block Macros Recap
- `${input.id}`: Address of input.
- `${output.id}`: Address of output.
- `${mem.id}`: Address of memory.
- `${reg.name}`: Address of register.
- `@section init`: Run once on program startup (e.g., LFO `wlds`). Use `skp run, skip_init`.
- `@section main`: Run every sample.

## 10. Memory Writes (`wra` vs `wrax`)
NEVER use `wrax` to write to delay memory!
- **Registers**: Use `wrax` to write into hardware registers (e.g. `wrax ${reg.mix_dry}, 1.0`).
- **Memory**: Use `wra` to write into delay lines (e.g. `wra ${mem.delay_line}, 0.0`).

## 11. Dropdown / Combobox Parameters
To create a dropdown option parameter instead of a number slider, use `"type": "select"` and provide an `"options"` array:
```json
    {
      "id": "mode",
      "name": "Mode",
      "type": "select",
      "default": 0,
      "options": [
        { "label": "Gated Reverb", "value": 0 },
        { "label": "Reverse Reverb", "value": 1 }
      ]
    }
```

## 12. Dynamic UI Custom Labels (`labelTemplate`)
If you provide a `"labelTemplate"` in the JSON, you can dynamically display parameter values. You MUST prefix parameter keys with `param.`:
```json
  "labelTemplate": "${param.mode == 0 ? 'Gated Reverb' : 'Reverse Reverb'}"
```

## 13. Exposing POT / CV Connectors
To allow the user to connect external CV inputs (such as FV-1 POTs) to parameters like `Mix` or `Feedback`, you MUST add corresponding entries to the `"inputs"` array of type `"control"`. If it's not in `"inputs"`, the user cannot patch a POT block to it!
```json
    { "id": "mixCV", "name": "Mix", "type": "control", "required": false }
```

## 14. FV-1 `wrap` Instruction Constraints
The `wrap` macro intrinsically dictates `Acc = Acc / 2 + Delay_Read` and `Delay_Write = Acc * 0.5 + Delay_Read`. 
Because it implicitly includes the input accumulator in its write back into the delay line, it CANNOT be used in scenarios where the phase of the accumulator needs to be negated or inverted (e.g. `Acc = -Acc / 2 + Delay_Read`). Attempting to negate the accumulator before a `wrap` instruction will cause the delay memory to recursively write back inverted values, forming an unstable positive feedback/resonant filter resulting in metallic ringing artifacts and uncontrollable gain stacking. If explicit mathematical phase tracking is required across all-pass filters without intrinsic gain side-effects, the `wrap` instruction must be manually unrolled using discrete `wra`/`rda`/`wrax`/`rdax` sequences.
