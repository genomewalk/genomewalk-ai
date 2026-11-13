import type { GenomeSource, MatchResult, MatchProgress, SearchOperations } from './types.ts';
import type { MatchGenomeOptions } from './genome-source.ts';

export type GenomeOperation =
  | { operation: 'identify'; file: File }
  | ({ operation: 'match' } & Omit<MatchGenomeOptions, 'fetchImpl' | 'onProgress' | 'signal'>);
export type GenomeReply =
  | ({ type: 'progress' } & MatchProgress)
  | { type: 'error'; message: string }
  | { type: 'result'; result: GenomeSource | MatchResult };
export type SearchOperation = {
  [K in keyof SearchOperations]: {
    id: number;
    operation: K;
    payload: SearchOperations[K]['input'];
  };
}[keyof SearchOperations];
export type SearchReply = { id: number } & (
  | { type: 'progress' | 'error'; message: string }
  | { type: 'result'; result: SearchOperations[keyof SearchOperations]['output'] }
);
