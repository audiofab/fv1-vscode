# Accumulator Forwarding Optimization

## Overview

The FV-1 has a single accumulator architecture. The accumulator forwarding optimization eliminates redundant register operations when one block's output flows directly to another block's input.

## Before Optimization

```assembly
; Block A
rdax INPUT_A, k1
wrax OUTPUT_A, 0.0    ; Clear accumulator

; Block B
rdax OUTPUT_A, k2     ; Load from register again
wrax OUTPUT_B, 0.0
```

## After Optimization

When Block A has exactly ONE consumer (Block B), and Block B reads that value as its primary input:

```assembly
; Block A
rdax INPUT_A, k1
wrax OUTPUT_A, 1.0    ; Keep value in accumulator

; Block B
; (skip rdax OUTPUT_A - value already in ACC)
sof k2, 0             ; Apply any needed scaling
wrax OUTPUT_B, 0.0
```

## Optimization Conditions

The optimization is applied when:
1. **Single Consumer**: An output has exactly ONE connection (one consumer block)
2. **Primary Input**: The consuming block processes it (typically as first input)

## Implementation

### Analysis Phase (Constructor)
- `analyzeAccumulatorForwarding()`: Analyzes the graph structure
- Marks outputs that can forward their accumulator value
- Stored in `Map<"blockId:portId", boolean>`

### Code Generation Phase
- `shouldPreserveAccumulator(blockId, portId)`: Checks if output should use `wrax reg, 1.0`
- `isAccumulatorForwarded(blockId, portId)`: Checks if input can skip `rdax`

## Benefits

1. **Fewer Instructions**: Eliminates 1-2 instructions per forwarded connection
2. **Better Performance**: Slight reduction in cycle count
3. **Automatic**: Compiler handles it transparently

## Example Test Case

See `examples/test-accumulator-forwarding.spndiagram`:
- Input -> Gain -> Output (3 blocks in a chain)
- Input has 1 consumer (Gain) → forwards accumulator
- Gain has 1 consumer (Output) → forwards accumulator
- Result: 2 `rdax` instructions saved

## Testing

1. Open `test-accumulator-forwarding.spndiagram` in the block diagram editor
2. Use "Export to Assembly" to generate FV-1 code
3. Look for:
   - `wrax adcl_out, k_one` (instead of `wrax adcl_out, k_zero`)
   - Missing `rdax` instructions where forwarding occurs
   - Comments indicating forwarding optimization

## Future Enhancements

- Support forwarding through blocks with multiple inputs (mixers)
- Chain multiple forwardings in longer signal paths
- More sophisticated primary input detection
