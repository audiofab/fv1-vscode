# Control Voltage (CV) Support

## Overview

The FV-1 Block Diagram Editor supports **Control Voltage** inputs for modulating block parameters in real-time. This allows you to use potentiometers, LFOs, or other control sources to dynamically modify effect parameters.

## Port Types

The editor distinguishes between two types of ports:

- **Audio Ports** (Green 🟢) - Carry audio signals
- **Control Ports** (Orange 🟠) - Carry control voltage (CV) signals for parameter modulation

## Blocks with CV Support

### Effects

#### Delay Block (`fx.delay`)
**Control Inputs:**
- `Time CV` - Modulates delay time
- `FB CV` - Modulates feedback amount  
- `Mix CV` - Modulates wet/dry mix

**Parameters:**
- Delay Time (0.001 - 1.0 seconds)
- Feedback (0.0 - 0.99)
- Mix (0.0 - 1.0)

### Math

#### Gain Block (`math.gain`)
**Control Inputs:**
- `Gain CV` - Modulates gain amount

**Parameters:**
- Gain (-2.0 to 2.0)

## Control Sources

### POT Block (`input.pot`)
Reads one of the three hardware potentiometers on the FV-1 board.

**Outputs:**
- `Control` (Orange 🟠) - POT value (0.0 to 1.0)

**Parameters:**
- POT Number (0, 1, or 2)

## Usage Example

### Basic POT-Controlled Gain

```
[POT0] --control--> [Gain]--audio--> [DAC L]
                      ^
                      |
            [ADC L]---+
```

1. Add a POT block (set to potentiometer 0)
2. Add a Gain block  
3. Add ADC L (audio input) and DAC L (audio output)
4. Connect: **ADC L** → Gain `Input` port (audio)
5. Connect: **POT0** → Gain `Gain CV` port (control - orange!)
6. Connect: Gain → **DAC L**

Now turning the physical potentiometer will control the gain in real-time!

### Advanced: POT-Controlled Delay Mix

```
[ADC L] --> [Delay] --> [DAC L]
             ^
             |
[POT0] -----+ (Mix CV)
```

Connect a POT to the Delay block's `Mix CV` input to create a manual wet/dry mix control.

## How CV Works

When a control input is connected:

1. **Base Value**: The parameter slider sets the *base* value
2. **CV Modulation**: The control signal modulates around that base value
3. **Code Generation**: The compiler generates FV-1 assembly code that reads the control signal

### Example Generated Code

Without CV:
```asm
; Gain Block
rdax REG0, 0.500000    ; Fixed gain of 0.5
wrax REG1, 0.0
```

With CV connected:
```asm
; Gain Block  
; Gain modulated by POT0
rdax REG0, 1.0         ; Read input
mulx POT0              ; Multiply by control signal
rdax REG0, -0.500000   ; Add offset for base gain
wrax REG1, 0.0
```

## Visual Indicators

- **Orange input ports** = Control (CV) inputs
- **Green input ports** = Audio inputs
- **Blue output ports** = Audio or control outputs
- **Connections**: All connections use the same bezier curve style

## Best Practices

1. **Use CV for dynamic effects** - Delay time, mix, feedback work great with CV
2. **Keep audio and control separate** - Don't mix audio and control signals
3. **Test with static values first** - Set parameter values, then add CV modulation
4. **Scale appropriately** - POT values are 0.0-1.0, may need offset/scaling

## Extending CV Support

To add CV support to your custom blocks:

```typescript
this._inputs = [
    { id: 'in', name: 'Input', type: 'audio', required: true },
    { id: 'rate_ctrl', name: 'Rate CV', type: 'control', required: false }
];
```

In `generateCode()`:
```typescript
const rateCtrlReg = ctx.getInputRegister(this.type, 'rate_ctrl');
if (rateCtrlReg) {
    // Use control signal
    code.push(`; Rate modulated by ${rateCtrlReg}`);
} else {
    // Use parameter value
    const rate = this.getParameterValue(ctx, this.type, 'rate', 1.0);
}
```

## Future Enhancements

Planned features:
- LFO blocks for automatic modulation
- Envelope followers for dynamic control
- More sophisticated CV scaling and offset controls
- Visual indication when CV is actively modulating a parameter
