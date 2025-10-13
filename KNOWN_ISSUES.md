# Known Issues

- Parsing the instruction `CHO RDAL, 8` fails. According to the datasheet this is not a valid instruction, but it is present in some algorithms I have seen, and SpinASM happily assembles it. Looking into it.