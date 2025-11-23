# Change Log

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
