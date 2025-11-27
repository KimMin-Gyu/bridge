export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue };

export type BridgeState = { [key: string]: unknown };

export type BridgeMethods = { [key: string]: (...args: unknown[]) => Promise<unknown> };

export type Bridge<S extends BridgeState, M extends BridgeMethods> = {
  state: S;
  methods: M;
};

export type BridgeClient<S extends BridgeState, M extends BridgeMethods> = S & {
  [K in keyof M]: M[K];
};

export type BridgeStore<T> = {
  getState: () => T;
  setState: (partial: Partial<T> | ((state: T) => Partial<T>)) => void;
  subscribe: (listener: (state: T) => void) => () => void;
} & T;

declare global {
  interface Window {
    __bridgeMethods__?: string[];
    __bridgeState__?: BridgeState;
    __bridgeCall?: (method: string, args: unknown[], timeout?: number) => Promise<unknown>;
    __onBridgeState?: (callback: (state: BridgeState) => void) => void;
  }
}
