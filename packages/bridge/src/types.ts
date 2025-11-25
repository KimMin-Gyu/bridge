export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue };

export type BridgeState = { [key: string]: unknown };

export type BridgeMethods = { [key: string]: (...args: unknown[]) => Promise<unknown> };

// 호스트(RN/Electron) 쪽에서 구현하는 브리지 전체 타입
export type Bridge<S extends BridgeState, M extends BridgeMethods> = {
  state: S;
  methods: M;
};

export type BridgeClient<S extends BridgeState, M extends BridgeMethods> = S & {
  [K in keyof M]: M[K];
};

declare global {
  interface Window {
    __bridgeMethods__?: string[];
    __bridgeState__?: BridgeState;
    __bridgeCall?: (method: string, args: unknown[], timeout?: number) => Promise<unknown>;
  }
}
