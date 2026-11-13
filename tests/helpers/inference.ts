import type { ModelEngine, SearchClient, SearchOperations } from '../../src/lib/types.ts';

// Supply unused lifecycle methods once; individual tests override the behavior under test.
export function fakeEngine(overrides: Partial<ModelEngine> = {}): ModelEngine {
  return {
    async *complete() {},
    async reset() {},
    async unload() {},
    interrupt() {},
    dispose() {},
    ...overrides,
  };
}
type SearchCall = (
  operation: keyof SearchOperations,
  payload: SearchOperations[keyof SearchOperations]['input'],
) => Promise<SearchOperations[keyof SearchOperations]['output']>;
export function fakeSearch(mock: {
  call: SearchCall;
  dispose?: () => void;
  hasIndex?: boolean;
}): SearchClient;
export function fakeSearch(mock: SearchCall): SearchClient;
export function fakeSearch(
  mock: SearchCall | { call: SearchCall; dispose?: () => void; hasIndex?: boolean },
): SearchClient {
  const invoke = typeof mock === 'function' ? mock : mock.call;
  return {
    hasIndex: true,
    async call(operation, payload) {
      // This adapter preserves the operation/result relationship of the worker protocol.
      return (await invoke(operation, payload)) as SearchOperations[typeof operation]['output'];
    },
    dispose: typeof mock === 'function' ? () => {} : (mock.dispose ?? (() => {})),
  };
}
