# Change Log

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
