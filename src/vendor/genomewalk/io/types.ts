/** Byte readers share this contract; a personal File never needs an HTTP source. */
export interface SourceMetadata {
  readonly size: number;
  readonly file?: { readonly name: string; readonly size: number };
  bytesRead?: number;
}

export interface ByteSource extends SourceMetadata {
  slice(start: number, end: number, signal?: AbortSignal): Promise<Uint8Array>;
}

export type Progress = (fraction: number) => void;
export type Status = (message: string) => void;
export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
