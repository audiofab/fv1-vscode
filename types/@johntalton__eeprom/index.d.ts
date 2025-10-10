declare module '@johntalton/eeprom' {
  // Reuse I2C types from @johntalton/and-other-delights to keep compatibility
  import type { I2CAddressedBus, I2CBufferSource } from '@johntalton/and-other-delights/lib/i2c-addressed';

  export const DEFAULT_EEPROM_ADDRESS: number;
  export const DEFAULT_WRITE_PAGE_SIZE: number;
  export const DEFAULT_READ_PAGE_SIZE: number;

  export type EEPROMOptions = {
    readPageSize?: number;
    writePageSize?: number;
  };

  export class Common {
    static read(bus: I2CAddressedBus, address: number, length: number, into?: I2CBufferSource): Promise<I2CBufferSource>;
    static write(bus: I2CAddressedBus, address: number, buffer: I2CBufferSource): Promise<void>;
  }

  export class EEPROM {
    static from(abus: I2CAddressedBus, options?: EEPROMOptions): EEPROM;

    constructor(abus: I2CAddressedBus, options?: EEPROMOptions);

    readPageSize: number;
    writePageSize: number;

    read(address: number, length: number, into?: I2CBufferSource): Promise<I2CBufferSource>;
    write(address: number, source: I2CBufferSource): Promise<void>;
  }

}
