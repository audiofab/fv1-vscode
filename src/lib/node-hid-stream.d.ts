// Minimal declarations for src/node-hid-stream.js
// This file provides typing for the JavaScript module so TypeScript doesn't
// treat imports from './node-hid-stream.js' as `any`.

export const REPORT_ID: number

// A very small subset of the HID device API used by the module.
// Replace or extend with the real types from 'node-hid' if you install
// @types/node-hid or migrate this file to reference that package.
export interface HIDDeviceLike {
  // listens for 'data' events: callback receives a Buffer or ArrayBufferView
  on(event: 'data', cb: (data: ArrayBuffer | ArrayBufferView | Buffer) => void): void
  removeAllListeners(event?: string): void
  // write accepts an array of numbers and returns number | void or a Promise thereof.
  // Some wrappers use an async write that returns a Promise<number>.
  write(data: number[] | Uint8Array): number | void | Promise<number | void>
}

export class NodeHIDStreamSource {
  constructor(device: HIDDeviceLike)
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>
}

export {}
