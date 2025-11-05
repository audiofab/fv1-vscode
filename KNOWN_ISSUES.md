# Known Issues

- Negation of a symbolic operand (using `!` or `~`) is unsupported at this time. A good example of this use case is needed to implement it.

- The ROM programs seem to behave oddly when assembled with the built-in assembler. Either they are invalid (I downloaded them from the Spin Semiconductor website), or the assembler isn't smart enough to deal with their fancy delay memory addressing schemes (more likely). To be investigated.