#!/usr/bin/env node
/**
 * INTERNAL production tool — provisions the MCP2221 on a stereo Easy Spin.
 * Deliberately NOT part of the shipped extension (scripts/ is in .vscodeignore).
 *
 * Writes three flash records:
 *   GP0          → GPIO / output / low   (the "programming in progress" handshake to the MCU)
 *   Manufacturer → "Audiofab Inc."
 *   Product      → "Easy Spin (Stereo)"
 *
 * VID/PID and the per-unit USB serial number are left untouched.
 *
 * The write is idempotent, preserves GP1..GP3, and is verified by read-back
 * before the chip is reset — a failed verify leaves the chip un-reset and still
 * reachable. Run once per pedal at build time.
 *
 * Usage:
 *   node scripts/provision-stereo-pedal.mjs            # show, confirm, provision, verify
 *   node scripts/provision-stereo-pedal.mjs --check    # read-only: report and exit
 *   node scripts/provision-stereo-pedal.mjs --yes      # skip the confirmation prompt
 *   node scripts/provision-stereo-pedal.mjs --force    # rewrite records that already match
 *   node scripts/provision-stereo-pedal.mjs --no-reset # write but don't reboot the chip
 *   node scripts/provision-stereo-pedal.mjs --serial 0004806114   # require a specific unit
 *   node scripts/provision-stereo-pedal.mjs --password 0011223344556677
 */
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

import HID from 'node-hid'
import { MCP2221 } from '@johntalton/mcp2221'
import {
  readMcp2221Configuration,
  describeMcp2221Configuration,
  provisionMcp2221,
  describeProvisionResult,
  identifyPedal,
  MCP2221_VENDOR_ID,
  MCP2221_PRODUCT_ID,
} from '@audiofab-io/fv1-core/pedal'

import { NodeHIDStreamSource } from '../src/lib/node-hid-stream.js'

const argv = process.argv.slice(2)
const has = flag => argv.includes(flag)
const valueOf = flag => {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}

const options = {
  check: has('--check'),
  yes: has('--yes') || has('-y'),
  force: has('--force'),
  reset: !has('--no-reset'),
  serial: valueOf('--serial'),
  password: valueOf('--password'),
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function fail(message) {
  console.error(`\n${message}`)
  process.exit(1)
}

async function open() {
  const devices = HID.devices().filter(
    d => d.vendorId === MCP2221_VENDOR_ID && d.productId === MCP2221_PRODUCT_ID
  )
  if (devices.length === 0) fail('No MCP2221 found. Is the pedal plugged in?')
  if (devices.length > 1) {
    fail(`${devices.length} MCP2221 devices are attached. Unplug all but the one to provision.`)
  }
  const hid = await HID.HIDAsync.open(devices[0].path)
  return { hid, device: new MCP2221(new NodeHIDStreamSource(hid)) }
}

let { hid, device } = await open()
const before = await readMcp2221Configuration(device)

console.log('\nCurrent configuration:')
console.log(describeMcp2221Configuration(before))

if (options.serial && before.usb.serialNumber !== options.serial) {
  await hid.close()
  fail(`Refusing to write: attached unit is serial ${before.usb.serialNumber}, not ${options.serial}.`)
}

if (options.check) {
  console.log(`\nIdentified as: ${identifyPedal(before).label}`)
  await hid.close()
  process.exit(0)
}

if (!options.yes) {
  const rl = createInterface({ input: stdin, output: stdout })
  const answer = await rl.question('\nProvision this device as a stereo Easy Spin? [y/N] ')
  rl.close()
  if (answer.trim().toLowerCase() !== 'y') {
    await hid.close()
    fail('Aborted.')
  }
}

let result
try {
  result = await provisionMcp2221(device, {
    force: options.force,
    reset: options.reset,
    password: options.password,
  })
} catch (error) {
  await hid.close()
  fail(`${error.message}`)
}

console.log('\nProvisioning:')
console.log(describeProvisionResult(result))

await hid.close()

if (!options.reset) {
  console.log('\nSkipped reset. Power-cycle or replug the pedal to load the new settings.')
  process.exit(0)
}

console.log('\nWaiting for re-enumeration...')
await sleep(3000)

;({ hid, device } = await open())
const after = await readMcp2221Configuration(device)
const identity = identifyPedal(after)
await hid.close()

console.log('\nAfter re-enumeration:')
console.log(describeMcp2221Configuration(after))
console.log(`\nIdentified as: ${identity.label}`)

if (!identity.isStereo) fail('Provisioning did not take: the pedal does not identify as stereo.')
console.log('\n✅ Pedal provisioned.')
