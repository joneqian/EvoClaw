/** Optional dependency: silk-wasm (SILK 音频解码) */
declare module 'silk-wasm' {
  export function decode(input: Buffer, sampleRate: number): Promise<{ duration: number; data: Buffer }>;
  export function encode(input: Buffer, sampleRate: number): Promise<{ data: Buffer }>;
}

/** Optional dependency: unpdf (PDF 文本提取) */
declare module 'unpdf' {
  interface DocumentProxy {
    numPages: number;
  }
  export function getDocumentProxy(data: Uint8Array | ArrayBuffer): Promise<DocumentProxy>;
  export function extractText(
    source: Uint8Array | ArrayBuffer | DocumentProxy,
    options?: { mergePages?: boolean },
  ): Promise<{ totalPages: number; text: string | string[] }>;
}
