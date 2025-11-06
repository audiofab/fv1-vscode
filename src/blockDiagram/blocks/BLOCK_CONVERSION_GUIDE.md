# SpinCAD to Block Diagram Conversion Guide

This guide provides instructions for converting SpinCAD blocks to the VS Code FV-1 block diagram system.

## File Locations

- **SpinCAD Templates**: `SpinCAD/src/SpinCADBuilder/*.spincad`
- **Generated Java Code**: `SpinCAD/src-gen/com/holycityaudio/SpinCAD/CADBlocks/*CADBlock.java`
- **Block Implementations**: `src/blockDiagram/blocks/effects/**/*.ts`
- **Block Registry**: `src/blockDiagram/blocks/BlockRegistry.ts`

## Block Structure Template

```typescript
/**
 * [Block Name]
 * Ported from SpinCAD's [OriginalName] block
 * 
 * [Description of what the block does]
 * 
 * Translation Notes:
 * - [Important implementation details]
 * - [Any quirks or special handling]
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class [BlockName]Block extends BaseBlock {
    readonly type = '[category].[subcategory].[name]';
    readonly category = '[Category]';
    readonly name = '[Display Name]';
    readonly description = '[Short description]';
    readonly color = '#[hex]';  // From SpinCAD .spincad @color
    readonly width = 180;

    constructor() {
        super();

        this._inputs = [
            { id: 'in', name: 'Input', type: 'audio', required: true },
            // Add control inputs from @controlInput directives
        ];

        this._outputs = [
            { id: 'out', name: 'Output', type: 'audio' }
        ];

        this._parameters = [
            // See Parameter Conversion section below
        ];

        this.autoCalculateHeight();
    }

    generateCode(ctx: CodeGenContext): void {
        // See Code Generation section below
    }
}
```

## SpinCAD File Analysis

### 1. Parse .spincad Template File

Look for these directives:

- `@name 'Display Name'` → `name` property
- `@color "0xRRGGBB"` → `color` property (convert to `#RRGGBB`)
- `@audioInput <varName> <PinName>` → Add to `_inputs` array
- `@audioOutput <varName> <PinName>` → Add to `_outputs` array
- `@controlInput <varName> <PinName>` → Add to `_inputs` array with `type: 'control'`
- `equ <varName> <defaultValue>` → Parameter default value
- `@sliderLabel <varName> <label> <min> <max> <multiplier> <precision> <option>` → Parameter definition

### 2. Parse .java Generated Code

Look for:

- `private double <varName> = <value>` → Default values
- `private int <varName>` → Register allocations needed
- `setter` methods with transformations (e.g., `Math.pow(10.0, __param/20.0)`) → Parameter conversions
- `generateCode()` method → Actual assembly generation logic
- `sfxb.allocateReg()` → Register allocation
- `sfxb.allocateMem()` → Memory allocation
- Instruction calls (`readRegister`, `writeRegister`, etc.) → Assembly instructions

## Parameter Conversion

### Basic Number Parameter

```typescript
{
    id: 'paramName',
    name: 'Display Name',
    type: 'number',
    default: 0.5,
    min: 0.0,
    max: 1.0,
    step: 0.01,
    description: 'Parameter description'
}
```

### Parameter with Display/Code Value Conversion

Use when the displayed value differs from the code value (e.g., Hz vs coefficient, dB vs linear):

```typescript
{
    id: 'frequency',
    name: 'Frequency',
    type: 'number',
    // Code values (what's stored internally)
    default: 0.15,
    min: 0.0,
    max: 1.0,
    step: 0.001,
    // Display values (what user sees)
    displayMin: 80,
    displayMax: 2500,
    displayStep: 10,
    displayDecimals: 0,
    displayUnit: 'Hz',
    // Conversion functions
    toDisplay: (coeff: number) => this.filterCoeffToHz(coeff),
    fromDisplay: (hz: number) => this.hzToFilterCoeff(hz),
    description: 'Filter cutoff frequency'
}
```

### Common Conversions

#### dB to Linear Gain
```typescript
// Code value (linear)
default: BaseBlock.dbToLinear(-6),
min: BaseBlock.dbToLinear(-40),
max: BaseBlock.dbToLinear(-3),
// Display value (dB)
displayMin: -40,
displayMax: -3,
displayUnit: 'dB',
toDisplay: (linear: number) => BaseBlock.linearToDb(linear),
fromDisplay: (db: number) => BaseBlock.dbToLinear(db),
```

#### Frequency (Hz to Filter Coefficient)
```typescript
// Code value (coefficient)
default: 0.15,
min: 0.0,
max: 1.0,
// Display value (Hz)
displayMin: 80,
displayMax: 2500,
displayUnit: 'Hz',
toDisplay: (coeff: number) => this.filterCoeffToHz(coeff),
fromDisplay: (hz: number) => this.hzToFilterCoeff(hz),
```

#### Time (Samples to Milliseconds)
```typescript
// Code value (samples)
default: 512,
min: 128,
max: 2048,
// Display value (ms)
displayMin: this.samplesToMs(128),
displayMax: this.samplesToMs(2048),
displayUnit: 'ms',
toDisplay: (samples: number) => this.samplesToMs(samples),
fromDisplay: (ms: number) => this.msToSamples(ms),
```

#### LFO Rate (Internal to Hz)
```typescript
// Code value (0-511)
default: 20,
min: 0,
max: 511,
// Display value (Hz)
displayMin: 0.0,
displayMax: this.lfoRateToHz(511),
displayUnit: 'Hz',
toDisplay: (rate: number) => this.lfoRateToHz(rate),
fromDisplay: (hz: number) => this.hzToLfoRate(hz),
```

### Select Parameter

```typescript
{
    id: 'lfoSel',
    name: 'LFO Select',
    type: 'select',
    default: 0,
    options: [
        { value: 0, label: 'LFO 0' },
        { value: 1, label: 'LFO 1' }
    ],
    description: 'Which LFO oscillator to use'
}
```

## Code Generation Patterns

### Standard Setup

```typescript
generateCode(ctx: CodeGenContext): void {
    // Get standard constants
    const zero = ctx.getStandardConstant(0.0);
    const one = ctx.getStandardConstant(1.0);
    const half = ctx.getStandardConstant(0.5);
    const negOne = ctx.getStandardConstant(-1.0);

    // Get input register (required)
    const inputReg = ctx.getInputRegister(this.type, 'in');
    if (!inputReg) {
        ctx.pushMainCode(`; [BlockName] (no input connected)`);
        return;
    }

    // Get optional control inputs
    const ctrlReg = ctx.getInputRegister(this.type, 'ctrl_name');

    // Allocate output register(s)
    const outputReg = ctx.allocateRegister(this.type, 'out');

    // Get parameters
    const param1 = this.getParameterValue(ctx, this.type, 'param1', defaultValue);

    // Add comment header
    ctx.pushMainCode(`; [Block Name] - [description]`);
    
    // Generate instructions...
}
```

### Memory Allocation

For blocks that need delay memory:

```typescript
// Allocate delay memory using MAX size from parameter definition
const delayLengthParam = this._parameters.find(p => p.id === 'delayLength');
if (!delayLengthParam?.max) {
    throw new Error(`${this.name} block: delayLength parameter max not defined`);
}
const maxDelayLength = delayLengthParam.max;
const memory = ctx.allocateMemory(this.type, maxDelayLength);
const delayOffset = memory.address;
const memoryName = memory.name;
```

### Register Allocation

```typescript
// Simple register allocation
const stateReg = ctx.allocateRegister(this.type, 'state');
const tempReg = ctx.allocateRegister(this.type, 'temp');

// Output register (connects to output pin)
const outputReg = ctx.allocateRegister(this.type, 'out');
```

### Conditional Code Based on Pin Connection

```typescript
// Check if control input is connected
const ctrlReg = ctx.getInputRegister(this.type, 'ctrl_name');

if (ctrlReg) {
    // Generate code when control is connected
    ctx.pushMainCode(`; Control input connected`);
    // Use MULX or other dynamic control instructions
} else {
    // Generate code for static parameter
    ctx.pushMainCode(`; Using fixed parameter value`);
    // Use more efficient instructions
}
```

### Init Code vs Main Code

```typescript
// Init code runs once at startup
ctx.pushInitCode(`; Initialize LFO (once at startup)`);
ctx.pushInitCode(`skp run, label_${this.sanitizeLabelForAsm(this.type)}_init`);
ctx.pushInitCode(`wlds SIN0, 50, 64`);
ctx.pushInitCode(`label_${this.sanitizeLabelForAsm(this.type)}_init:`);

// Main code runs every sample
ctx.pushMainCode(`; Process audio`);
ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(1.0)}`);
```

## SpinCAD Java to FV-1 Assembly Mapping

### Common SpinFXBlock Methods

| Java Method | FV-1 Instruction | Notes |
|-------------|------------------|-------|
| `readRegister(reg, scale)` | `rdax reg, scale` | Read and multiply |
| `writeRegister(reg, scale)` | `wrax reg, scale` | Write and multiply |
| `readRegisterFilter(reg, coeff)` | `rdfx reg, coeff` | Read with filter |
| `writeRegisterLowshelf(reg, scale)` | `wrlx reg, scale` | Low-shelf filter |
| `writeRegisterHighshelf(reg, scale)` | `wrhx reg, scale` | High-shelf filter |
| `mulx(reg)` | `mulx reg` | Multiply by register |
| `loadAccumulator(value)` | `sof 0, value` or `or value` | Load constant |
| `scaleOffset(scale, offset)` | `sof scale, offset` | Scale and offset |
| `readDelay(addr, scale)` | `rda addr, scale` | Read from delay |
| `writeDelay(addr, scale)` | `wra addr, scale` | Write to delay |
| `writeDelayPointer(addr)` | `wra addr, 0` | Write and clear |
| `readDelayPointer(addr, scale)` | `rmpa scale` | Read at pointer |
| `writeAllpass(addr, scale)` | `wrap addr, scale` | Allpass filter |
| `choRdal(lfoSel)` | `cho rdal, SIN0/1` | Chorus read address LFO |
| `choRda(lfoSel, flags, addr)` | `cho rda, SIN0/1, flags, addr` | Chorus read with flags |

### Register Name Mapping

SpinCAD register allocations become FV-1 register names:
- `allocateReg()` → `REG0`, `REG1`, etc. (managed by context)
- Use descriptive names in allocation: `ctx.allocateRegister(this.type, 'lpf_state')`

## Special Cases and Gotchas

### 1. Pin Connection Checks
Always check if required pins are connected before generating code:
```typescript
if (!inputReg) {
    ctx.pushMainCode(`; [BlockName] (no input connected)`);
    return;
}
```

### 2. SpinCAD's @isPinConnected Directive
Maps to checking if control input exists:
```typescript
// SpinCAD: @isPinConnected ControlName
const ctrlReg = ctx.getInputRegister(this.type, 'ctrl_name');
if (ctrlReg) {
    // Pin is connected
}
```

### 3. Number Formatting
Always use `this.formatS1_14()` for S1.14 fixed-point values:
```typescript
ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(0.5)}`);
```

### 4. Label Sanitization
Use `this.sanitizeLabelForAsm()` for jump labels:
```typescript
const label = `skip_${this.sanitizeLabelForAsm(this.type)}_end`;
```

### 5. Memory Allocation
Always allocate maximum possible memory size to allow parameter changes without recompilation:
```typescript
const maxSize = this._parameters.find(p => p.id === 'delayLength')?.max;
const memory = ctx.allocateMemory(this.type, maxSize);
```

### 6. LFO Initialization
LFOs must be initialized in init code, typically with hardcoded values (not parameters):
```typescript
ctx.pushInitCode(`wlds SIN0, 50, 64`);  // 50 and 64 are hardcoded
```

### 7. Accumulator State
Be mindful of accumulator state between instructions. The last value in ACC is what gets written.

## Testing New Blocks

1. **Compilation Test**: Ensure block compiles without TypeScript errors
2. **Registration Test**: Verify block appears in block palette
3. **Code Generation Test**: Create a simple diagram and view assembly output
4. **Resource Test**: Check instruction/register/memory usage is reasonable
5. **Parameter Test**: Verify parameter ranges and conversions work correctly

## Utility Methods Available in BaseBlock

- `formatS1_14(value)` - Format value as S1.14 fixed-point
- `hzToFilterCoeff(hz)` - Convert Hz to filter coefficient
- `filterCoeffToHz(coeff)` - Convert coefficient to Hz
- `samplesToMs(samples)` - Convert samples to milliseconds (@ 32.768 kHz)
- `msToSamples(ms)` - Convert milliseconds to samples
- `lfoRateToHz(rate)` - Convert LFO rate (0-511) to Hz
- `hzToLfoRate(hz)` - Convert Hz to LFO rate
- `sanitizeLabelForAsm(label)` - Make label safe for assembly
- `BaseBlock.dbToLinear(db)` - Convert dB to linear gain (static)
- `BaseBlock.linearToDb(linear)` - Convert linear gain to dB (static)
- `getParameterValue(ctx, blockType, paramId, defaultValue)` - Get parameter value

## Block Categories

Use these standard categories:
- `Input` - ADC, Pot, CV inputs
- `Output` - DAC outputs  
- `Math` - Gain, Volume, Mixers
- `Delay` - Delay lines, echoes
- `Modulation` - Chorus, Flanger, Phaser
- `Filter` - LPF, HPF, shelving, etc.
- `Dynamics` - Compressor, Limiter, etc.
- `Control` - LFO, Envelope, etc.

## Example: Complete Conversion Workflow

1. **Find SpinCAD files**: `Shelving_Hipass.spincad` and `Shelving_HipassCADBlock.java`
2. **Extract metadata**: Name, color, inputs, outputs from .spincad
3. **Identify parameters**: From `@sliderLabel` and setter methods in .java
4. **Map instructions**: Convert SpinFXBlock calls to FV-1 assembly
5. **Handle conditionals**: Use `@isPinConnected` to branch code generation
6. **Create TypeScript file**: Follow template structure
7. **Register block**: Add import and registration in `BlockRegistry.ts`
8. **Test**: Create diagram, verify assembly output

## Common Pitfalls to Avoid

1. ❌ Don't use parameter values directly - use `getParameterValue()`
2. ❌ Don't forget to check if required inputs are connected
3. ❌ Don't allocate less memory than the parameter's max value
4. ❌ Don't forget to call `autoCalculateHeight()` in constructor
5. ❌ Don't use raw numbers - use `formatS1_14()` for coefficients
6. ❌ Don't forget to update `BlockRegistry.ts` imports and registration
7. ❌ Don't mix display and code values - use proper conversions
8. ❌ Don't forget to add blank line after code sections for readability

## Success Checklist

- [ ] Block compiles without errors
- [ ] Block registered in BlockRegistry.ts
- [ ] All parameters have proper ranges and defaults
- [ ] Display/code conversions implemented correctly
- [ ] Required inputs checked before code generation
- [ ] Memory allocated at maximum size (if needed)
- [ ] Assembly output matches SpinCAD behavior
- [ ] Comments explain any complex logic
- [ ] Type string follows convention: `category.subcategory.name`
