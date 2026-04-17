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

/** Optional dependency: playwright (浏览器自动化完整模式) */
declare module 'playwright' {
  export interface Page {
    goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
    title(): Promise<string>;
    textContent(selector: string): Promise<string | null>;
    click(selector: string): Promise<void>;
    fill(selector: string, value: string): Promise<void>;
    screenshot(opts?: { type?: 'png' | 'jpeg'; fullPage?: boolean }): Promise<Uint8Array>;
    evaluate<T = unknown>(script: string | (() => T)): Promise<T>;
  }
  export interface Browser {
    newPage(): Promise<Page>;
    close(): Promise<void>;
  }
  export const chromium: {
    launch(opts?: { headless?: boolean }): Promise<Browser>;
  };
}
