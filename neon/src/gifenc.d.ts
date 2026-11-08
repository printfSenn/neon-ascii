declare module 'gifenc' {
  export const GIFEncoder: () => any;
  export const applyPalette: (pixels: Uint8ClampedArray, palette: number[][]) => Uint8Array;
  export const quantize: (pixels: Uint8ClampedArray, count: number) => number[][];
}
