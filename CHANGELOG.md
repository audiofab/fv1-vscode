# Change Log

## [1.8.0]

- Pick up latest fv1-core (0.13.0) with a bunch of new features :)
- Add an export bank to HEX feature
- Dynamic POT labels in the simulator
- Read from pedal in the simulator
- Loading a .hex now writes only the regions the file covers, so program slots the
  file leaves out are no longer erased
- Programming a bank now runs in a single connection instead of reconnecting per slot

## [1.7.2]

- Pick up latest fv1-core (0.6.16) with a fix to simple chorus and flanger blocks
- Remove redundant and broken resource usage pills from block diagram editor

## [1.7.1]

- Pick up latest fv1-core (0.6.15) with a few more minor fixes (in particular the ramp_lfo block)

## [1.7.0]

- Pick up latest fv1-core (0.6.14) with a major block audit
  - **Unified Mix behaviour**: all Mix controls now use a constant-power
    crossfade, holding level flat across the sweep instead of dipping ~3 dB
    in the middle (Bit-Mangler, Chiptune, Guitar Synth, Organ Synth, Auto Wah)
  - **Headroom fixes**: Organ Synth drawbars are now normalised (previously
    distorted at every usable input level), Spring Reverb and 2-Pole SVF no
    longer clip internally, Room Reverb output level matched to the other reverbs
  - **Blocks that were partly or wholly inert now work**: Chiptune's noise
    channel and ring modulator, the Ramp LFO, and Ducking Reverb's Sensitivity
    control
  - **CV controls now consistent**: a connected CV scales *within* the
    parameter's value rather than replacing it. Note: patches driving the
    Sin/Cos LFO Speed from a pot will run faster at the same knob position
  - Room Reverb decay roughly doubles at the same Reverb Time; Allpass controls
    capped at 0.7 and Micro-Stutter Wet Level at 1.0, above which they distorted
  - Compiler/assembler: fixed dead-store elimination deleting live state at
    optimization level 2, `@if` conditions silently dropping guarded code,
    out-of-range branches encoding silently, and duplicate labels colliding
- Debugger: live reload — edit assembly or block parameters while running
- Debugger: fixed a session leak and large performance improvements in the scope
- Fixed the spectrogram not drawing until the panel was resized
- Block diagram editor: ports snap when wiring, and each modified parameter
  has a "Reset to Default" button
- Removed `fv1.hardware.regCount` and `fv1.hardware.delaySize` settings — both
  are fixed by the FV-1 instruction encoding and were never adjustable in practice

## [1.6.7]

- Pick up latest fv1-core
  - Improve simple reverb and fix a few other block issues.

## [1.6.6]

- Pick up latest fv1-core
  - Fix SIN/COS LFO block. Add Eight Tap Delay block.
- Add MCP server for AI-assisted block diagram generation!

## [1.6.5]

- Update dependabot dependencies
- Move to new Azure deployment workflow

## [1.6.4]

- Update assembler to fix a bug in CHO RDA

## [1.6.3]

- Update simulator to fix a bug in RMPA instruction

## [1.6.2]

- Add an export to JSON for easy-spin-web and MOD plugin purposes
- Make error more obvious when no programmer is detected

## [1.6.1]

- Bump fv1-core to pick up unconnected output bugfix

## [1.6.0]

- Update simulator to mirror easy-spin.audiofab.com
  (old simulator workflow is now "debugging")
- Move creation of .spnbank files into the simulator panel

## [1.5.2]

- Move extension to use new fv1-core npm module

## [1.5.1]

- Fix LFO wrapping bug in the simulator
- Add proper delay memory read visualization

## [1.5.0]

- Add an organ synth block
- Minor bugfixes

## [1.4.9]

- Minor bugfixes
- Fix broken deployment

## [1.4.8]

- Minor block bugfixes
- The addition of numerous new blocks including:
  - Entropy LFO
  - Bit Mangler
  - Chip Tune
  - Tape Degrade
  - Ducking Reverb
  - Spectral Smear
  - Harmonic Tremolo
  - Micro Stutter
  - Sub Octave
  - Auto Wah
  - BBD Loss

## [1.4.7]

- Improve the optimizer

## [1.4.6]

- Fix color schemes to work with recent VS Code change
- Add zero POT bypass feature

## [1.4.5]

- Fix a couple of bugs in the SVF and Phaser blocks
- Improve arbitrary signal plotting

## [1.4.4]

- Added an MN3011 block
- Fixed a few bugs related to SVF and aggressive optimization

## [1.4.3]

- **New Blocks**: Envelope follower, Phaser effect, and four new Pitch shifting effects (pitch shifter, fixed offset, dual offset, octave up/down)
- **Enhanced Filters**: Added 1-pole high-pass and low-pass filters, plus 2-pole State Variable Filter (SVF)
- **New Mixers**: 2-channel and 3-channel mixers with independent level control
- **Aggressive Code Optimization**: Level 2 optimization now includes dead store elimination and section flattening for maximum code density
- **Improved Simulator**: Expanded audio stimulus library with eight test tracks for comprehensive testing scenarios and improved oscilloscope refresh rate controls
- **Parameter Control**: Blocks now support `parameter` property for enhanced control input flexibility with `@cv` macro support
- **Visual Labels**: New `labelTemplate` support for dynamic parameter display in block diagrams

## [1.4.2]

- Add ramp LFO and fix sincos LFO and tremolozer
- Allow self connections (for feedback)
- Hide spectrogram by default in simulator

## [1.4.1]

- Improved error handling
- More assembler optimizations
- User documentation!

## [1.4.0]

- Introduce a completely new assembler
- Introduce a simulator with realtime audio, oscilloscope and spectrogram
- Full source-level debugging of .spn assembly (in the simulator)
- Improved block diagram templating language (ATL - Audiofab Template Language)
- Support for larger limits on memory, number of registers and program words (simulation only)

## [1.3.3]

- Improve assembler to support JMP instruction and some other edge cases

## [1.3.2]

- Fix plate and spring reverb blocks

## [1.3.1]

- Fix an assembler bug I introduced when resolving memory addresses in EQU values
- Add more assembler tests
- Fix CoarseDelayBlock

## [1.3.0]

- Fix a relative path issue in the bank editor

## [1.2.9]

- node-hid packaging was still broken in the deployed extension - attempt #2

## [1.2.8]

- Fix broken node-hid packaging

## [1.2.7]

- Bundle the extension by following the bundling guide

## [1.2.6]

- Add an assembler test framework
- Fix assembler to support all Spin Semiconductor ROM programs
- Added clampReals option

## [1.2.5]

- A few bugfixes and integrate dependabot changes
- Auto-generate comments for potentiometer connections
- Add a plate and spring reverb block

## [1.2.4]

- Add a Minimal and Room Reverb block as well as a Constant block
- Add a couple Tone Generator blocks
- Minor UI improvements

## [1.2.3]

- Add sticky notes
- Add some more blocks (still a few untested)
- Fix a few bugs

## [1.2.2]

- Add some more blocks (untested)

## [1.2.1]

- Minor fixes

## [1.2.0]

- Block diagram programming support!
- Replaced Easy Spin Banks View with a more full-featured .spnbank editor
- Realtime compilation of the block diagram with resource usage reporting

## [1.1.1]

- Major editor UI enhancements

## [1.1.0]

- Added support for programming a .hex file to EEPROM
- Added a "Backup pedal" command to save the current pedal contents to a .hex file

## [1.0.9]

- Added support for exporting an entire bank to a .hex file

## [1.0.8]

- Added support for assigning programs to all 8 program slots and saving as a .spnbank file
- Added Easy Spin Banks view for assigning programs to banks and programming the entire bank

## [1.0.7]

- Move assembler output to the Output window
- Create problems in the Problems view and editor for assembly errors and warnings

## [1.0.6]

- Clean up syntax highlighting (resolve issue #1)

## [1.0.5]
### The Thanksgiving Release

- Minor internal assembler cleanup

## [1.0.4]

- Fixed some major delay memory allocation bugs
- Defaulted delay memory allocation to behave the same as SpinASM IDE in case I am missing something
- Fixed resolution of EQU symbols to mimic SpinASM IDE
- Added support to resolve arbitrary numeric expressions (massive Plat Reverb program now properly assembles)

## [1.0.3]

- Added a command to output to Intel HEX format

## [1.0.2]

- Added a logo to the Marketplace entry
- Added a Known Issues file
- Fix "CHO RDAL" and "RDAX" implementations due to errors in the datasheet
- Fix a rounding error when converting fixed point values

## [1.0.1]

- Fixed a bug with negative frequencies in the WLDR instruction

## [1.0.0]

- Initial release supporting syntax highlighting and assembly of FV-1 programs as well as programming the EEPROM in the [Audiofab Easy Spin(https://audiofab.com/products/easy-spin)] pedal using the [Audiofab USB Programmer](https://audiofab.com/store/easy-spin-programmer)
