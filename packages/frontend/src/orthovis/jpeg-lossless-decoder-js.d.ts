declare module 'jpeg-lossless-decoder-js' {
  export const lossless: {
    Decoder: new (buf?: ArrayBuffer | ArrayBufferView) => {
      decode(buf?: ArrayBuffer | ArrayBufferView, ...args: any[]): Uint8Array | Uint16Array | Int16Array
      decompress?: (...args: any[]) => any
    }
  }
  const _default: typeof lossless
  export default _default
}
