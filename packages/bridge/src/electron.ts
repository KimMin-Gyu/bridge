// packages/bridge/electron.ts
// Electron main process용 createBridge

import type { BridgeStore } from './types';

type StateCreator<T> = (
  get: () => T,
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void
) => T;

export function createBridge<T extends Record<string, any>>(
  createState: StateCreator<T>
): BridgeStore<T> {
  type InternalState = T;
  let state = {} as InternalState;
  const listeners = new Set<(state: InternalState) => void>();

  const get = (): InternalState => state;
  const set = (partial: Partial<InternalState> | ((state: InternalState) => Partial<InternalState>)) => {
    const nextState = typeof partial === "function" ? partial(state) : partial;
    state = { ...state, ...nextState };
    listeners.forEach((listener) => listener(state));
  };

  state = createState(get, set);

  const subscribe = (listener: (state: InternalState) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const getState = () => state;
  const setState = set;

  // Use Proxy to maintain method references while providing store API
  const store = new Proxy({} as BridgeStore<T>, {
    get(target, prop) {
      if (prop === 'getState') return getState;
      if (prop === 'setState') return setState;
      if (prop === 'subscribe') return subscribe;
      // Always get from current state, not closure
      const currentState = getState();
      return currentState[prop as keyof T];
    },
    set(target, prop, value) {
      if (prop === 'getState' || prop === 'setState' || prop === 'subscribe') {
        return false;
      }
      (state as Record<string, unknown>)[prop as string] = value;
      return true;
    }
  });

  return store;
}

export type { BridgeStore } from './types';
