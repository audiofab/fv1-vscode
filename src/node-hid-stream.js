

// import HID from 'node-hid'

export const REPORT_ID = 0

function getReadStream(device, enableBYOB = false) {
	// because this is a 'bytes' stream, this queuing strategy
	// is always ByteLengthQueuingStrategy (https://streams.spec.whatwg.org/#blqs-class)
	const queuingStrategy = {
		highWaterMark: 64
	}

	return new ReadableStream({
		//autoAllocateChunkSize: 64,
		type: 'bytes',
		start(controller) {
      device.on('data', data => {

        // buffer contains first byte as reportId IFF device supports
        // https://github.com/signal11/hidapi/blob/master/hidapi/hidapi.h#L224C35-L224C51
        const reportId = REPORT_ID

				// for now only report zero, until we return in buffer
				if(reportId !== REPORT_ID) { controller.error('report id miss-match') }

				if (enableBYOB && (controller.byobRequest !== null) && (controller.byobRequest.view !== null)) {
					const { view } = controller.byobRequest
					const bytesRead = data.byteLength

					// normalize data from a DataView to Uint8Array
					const input = ArrayBuffer.isView(data) ?
						new Uint8Array(data.buffer, data.byteOffset, data.byteLength) :
						new Uint8Array(data)

					// copy-into
					console.log('copy-into')
					view.set(input)

					controller.byobRequest.respond(bytesRead)
				}
				else {
					// console.log('queuing data in readable hid stream')
					controller.enqueue(data)
				}
			})
		},
		cancel() {
			console.log('hid stream canceled')
      device.removeAllListeners()

		}
	},
	queuingStrategy)
}

function getWriteStream(device) {
	const queuingStrategy = new ByteLengthQueuingStrategy({ highWaterMark: 64 })

  const reportIdZeroByte = Uint8Array.from([ REPORT_ID ])

	return new WritableStream({
		start(controller) {},
    async write(chunk, controller) {
			// console.log('send report')

      const blob = new Blob([ reportIdZeroByte, chunk ])
      const buffer = await blob.arrayBuffer()
      // console.log([ ...(new Uint8Array(buffer)) ])
      return device.write([ ...(new Uint8Array(buffer)) ])

      // const chunk8 = ArrayBuffer.isView(chunk) ?
      //   new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength) :
      //   new Uint8Array(chunk)

      // const report8 = new Uint8Array(chunk8.byteLength)
      // report8[0] = REPORT_ID
      // report8.set(chunk8)
      // return hid.write([ ...(new Uint8Array(report8)) ])

      // const report = ArrayBuffer.isView(chunk) ? chunk.buffer.transfer(chunk.byteLength + 1) : chunk.transfer(chunk.byteLength + 1)
      // const report8 = (new Uint8Array(report)).copyWithin(1, 0)
      // report8[0] = REPORT_ID
      // return hid.write([ ...report8 ])
		},
    close(controller) {
			console.log('hid stream writer close')
		},
    abort(reason) {
			console.log('hid stream writer abort')
		}
	},
	queuingStrategy)
}


export class NodeHIDStreamSource {
	#r
	#w
	#device

	constructor(device) { this.#device = device }

	get readable() {
		if(this.#r === undefined) {
			this.#r = getReadStream(this.#device)
		}

		return this.#r
	}

	get writable() {
		if(this.#w === undefined) {
			this.#w = getWriteStream(this.#device)
		}

		return this.#w
	}
}