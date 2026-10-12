/** Reading and writing binary glTF for the scripts that vendor and pack Tower 3D's characters. */
import { readFileSync, writeFileSync } from 'node:fs'

export type Json = Record<string, any>
export type Glb = { json: Json; bin: Buffer }

export function readGlb(file: string): Glb {
  const glb = readFileSync(file)
  if (glb.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${file} is not a binary glTF`)
  const length = glb.readUInt32LE(12)
  const json = JSON.parse(glb.toString('utf8', 20, 20 + length))
  const at = 20 + length
  return { json, bin: glb.subarray(at + 8, at + 8 + glb.readUInt32LE(at)) }
}

const pad = (b: Buffer, fill: number) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b)

export function writeGlb(file: string, json: Json, bin: Buffer) {
  const text = pad(Buffer.from(JSON.stringify(json)), 0x20)
  const data = pad(bin, 0)
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + text.length + 8 + data.length, 8)
  const chunk = (b: Buffer, type: string) => {
    const h = Buffer.alloc(8)
    h.writeUInt32LE(b.length, 0)
    h.write(type, 4, 'ascii')
    return [h, b]
  }
  writeFileSync(file, Buffer.concat([header, ...chunk(text, 'JSON'), ...chunk(data, 'BIN\0')]))
}

/** A GLB being written: what is copied into it gets a buffer view of its own. */
export function writer(json: Json) {
  const chunks: Buffer[] = []
  let length = 0
  json.buffers = [{ byteLength: 0 }]
  json.bufferViews = []
  json.accessors = []
  const view = (bytes: Buffer) => {
    json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length })
    const padded = pad(bytes, 0)
    chunks.push(padded)
    length += padded.length
    return json.bufferViews.length - 1
  }
  const bytesOf = (src: Glb, viewIndex: number) => {
    const v = src.json.bufferViews[viewIndex]
    if (v.byteStride) throw new Error('interleaved buffer views are not copied')
    return src.bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)
  }
  return {
    accessor(src: Glb, i: number) {
      const a = src.json.accessors[i]
      if (a.sparse) throw new Error('sparse accessors are not copied')
      json.accessors.push({ ...a, bufferView: view(bytesOf(src, a.bufferView)), byteOffset: undefined })
      return json.accessors.length - 1
    },
    /** An accessor described by `fields`, holding `bytes`. */
    data(fields: Json, bytes: Buffer) {
      json.accessors.push({ ...fields, bufferView: view(bytes), byteOffset: undefined })
      return json.accessors.length - 1
    },
    image(src: Glb, i: number) {
      const img = src.json.images[i]
      json.images ??= []
      json.images.push({ name: img.name, mimeType: img.mimeType, bufferView: view(bytesOf(src, img.bufferView)) })
      return json.images.length - 1
    },
    /** An image held as its file's bytes. */
    png(name: string, bytes: Buffer) {
      json.images ??= []
      json.images.push({ name, mimeType: 'image/png', bufferView: view(bytes) })
      return json.images.length - 1
    },
    bin() {
      json.buffers[0].byteLength = length
      return Buffer.concat(chunks)
    },
  }
}
