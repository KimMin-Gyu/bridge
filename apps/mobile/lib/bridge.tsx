// packages/bridge/native.tsx

import React, {
  useEffect,
  useMemo,
  useRef,
  useCallback,
  useState,
  useSyncExternalStore,
} from "react";

import WebView, {
  WebViewMessageEvent,
  WebViewProps,
} from "react-native-webview";
import type { BridgeState, BridgeMethods } from "@repo/bridge/types";

type NativeBridgeProps<
  S extends BridgeState,
  M extends BridgeMethods
> = Omit<WebViewProps, "onMessage" | "injectedJavaScript" | "ref" | "source"> & {
  /** WebView 소스 (uri 또는 html 등) */
  source: WebViewProps["source"];
  /** 호스트(RN) 쪽 브리지 상태 */
  bridgeState: S;
  /** 호스트(RN) 쪽 브리지 메서드 구현체 */
  bridgeMethods: M;
  /** 원래 WebView onMessage를 쓰고 싶다면 여기로 */
  onBridgeMessage?: (event: WebViewMessageEvent) => void;
  /** 디버깅 플래그 */
  debug?: boolean;
};

type BridgeCallMessage = {
  type: "bridge-call" | "console";
  id: string;
  method: string;
  args: unknown[];
};

const buildInjectScript = (methods: string[], initialState: BridgeState, debug: boolean) => `
  (function() {
    // 메서드 목록과 초기 상태 주입
    window.__bridgeMethods__ = ${JSON.stringify(methods)};
    window.__bridgeState__ = ${JSON.stringify(initialState)};

    // pending map with cleanup
    if (!window.__bridgePending) window.__bridgePending = {};
    if (!window.__bridgeTimeouts) window.__bridgeTimeouts = {};

    // cleanup function for expired promises
    window.__cleanupExpiredPromises = function() {
      var now = Date.now();
      for (var id in window.__bridgeTimeouts) {
        if (window.__bridgeTimeouts[id] <= now) {
          var pending = window.__bridgePending[id];
          if (pending) {
            pending.reject(new Error("Bridge call timeout"));
            delete window.__bridgePending[id];
          }
          delete window.__bridgeTimeouts[id];
        }
      }
    };

    // periodic cleanup (every 30 seconds)
    if (!window.__bridgeCleanupInterval) {
      window.__bridgeCleanupInterval = setInterval(window.__cleanupExpiredPromises, 30000);
    }

    // RPC 호출 함수
    window.__bridgeCall = function(method, args, timeout) {
      return new Promise(function(resolve, reject) {
        var id = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
        var timeoutMs = timeout || 30000; // default 30s timeout
        
        window.__bridgePending[id] = { resolve: resolve, reject: reject };
        window.__bridgeTimeouts[id] = Date.now() + timeoutMs;
        
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: "bridge-call",
            id: id,
            method: method,
            args: Array.prototype.slice.call(args || []),
          }));
        } else {
          delete window.__bridgePending[id];
          delete window.__bridgeTimeouts[id];
          reject(new Error("ReactNativeWebView not available"));
        }
      });
    };

    // 응답 처리 함수
    window.__handleBridgeResponse = function(message) {
      try {
        var msg = typeof message === "string" ? JSON.parse(message) : message;
        if (!msg || !msg.id) return;
        var pending = window.__bridgePending[msg.id];
        if (!pending) return;
        
        // cleanup both pending and timeout
        delete window.__bridgePending[msg.id];
        delete window.__bridgeTimeouts[msg.id];
        
        if (msg.ok) pending.resolve(msg.result);
        else pending.reject(new Error(msg.error || "Bridge error"));
      } catch (e) {
        console.error("bridge response error", e);
      }
    };

    var originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      info: console.info.bind(console),
    };

    ['log', 'warn', 'error', 'info'].forEach(function(method) {
      console[method] = function() {
        var args = Array.prototype.slice.call(arguments);
        originalConsole[method].apply(console, args);
        
        try {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: "console",
              level: method,
              args: args,
            }));
          }
        } catch (e) {
          // ignore
        }
      };
    });

    // cleanup on page unload
    window.addEventListener("beforeunload", function() {
      if (window.__bridgeCleanupInterval) {
        clearInterval(window.__bridgeCleanupInterval);
        window.__bridgeCleanupInterval = null;
      }
      // reject all pending promises
      for (var id in window.__bridgePending) {
        var pending = window.__bridgePending[id];
        if (pending) {
          pending.reject(new Error("Page unloading"));
        }
      }
      window.__bridgePending = {};
      window.__bridgeTimeouts = {};
    });

    // ready 이벤트
    var ev;
    try {
      ev = new Event("bridge-ready");
    } catch (_) {
      ev = document.createEvent("Event");
      ev.initEvent("bridge-ready", true, true);
    }
    window.dispatchEvent(ev);
  })();
  true;
`;

const buildEmitStateScript = (state: BridgeState) => `
  (function() {
    window.__bridgeState__ = ${JSON.stringify(state)};
    var detail = window.__bridgeState__;
    var ev;
    try {
      ev = new CustomEvent("bridgeStateChange", { detail: detail });
    } catch (_) {
      ev = document.createEvent("CustomEvent");
      ev.initCustomEvent("bridgeStateChange", true, true, detail);
    }
    window.dispatchEvent(ev);
  })();
  true;
`;

type ConsoleMessage = {
  type: "console";
  level: "log" | "warn" | "error" | "info";
  args: unknown[];
};

// Zustand-style Bridge API
export type BridgeStore<T> = {
  getState: () => T;
  setState: (partial: Partial<T> | ((state: T) => Partial<T>)) => void;
  subscribe: (listener: (state: T) => void) => () => void;
} & T;

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
      (state as any)[prop] = value;
      return true;
    }
  });

  return store;
}

export function useBridge<T extends Record<string, any>, U = T>(
  bridge: BridgeStore<T>,
  selector?: (state: T) => U
): U {
  const state = useSyncExternalStore(
    bridge.subscribe,
    bridge.getState,
    bridge.getState
  );

  if (selector) {
    return selector(state);
  }

  return state as unknown as U;
}

type BridgeWebViewProps<T> = Omit<WebViewProps, "onMessage" | "injectedJavaScript" | "ref" | "source"> & {
  source: WebViewProps["source"];
  bridge: BridgeStore<T>;
  onBridgeMessage?: (event: WebViewMessageEvent) => void;
  debug?: boolean;
};

export function BridgeWebView<T extends Record<string, any>>({
  source,
  bridge,
  onBridgeMessage,
  debug = true,
  ...rest
}: BridgeWebViewProps<T>) {
  const webviewRef = useRef<WebView>(null);
  const [, forceUpdate] = useState({});

  // Subscribe to store changes
  useEffect(() => {
    const unsubscribe = bridge.subscribe(() => {
      forceUpdate({});
    });
    return unsubscribe;
  }, [bridge]);

  const state = bridge.getState();

  // Separate state and methods with useMemo
  const { bridgeState, bridgeMethods } = useMemo(() => {
    const bridgeState: BridgeState = {};
    const bridgeMethods: BridgeMethods = {};

    Object.entries(state).forEach(([key, value]) => {
      if (typeof value === "function") {
        bridgeMethods[key] = value;
      } else {
        bridgeState[key] = value;
      }
    });

    return { bridgeState, bridgeMethods };
  }, [state]);

  const methodNames = useMemo(
    () => Object.keys(bridgeMethods),
    [bridgeMethods]
  );

  const injectedJavaScript = useMemo(
    () => buildInjectScript(methodNames, bridgeState, debug),
    [methodNames, bridgeState, debug]
  );

  const prevStateRef = useRef<BridgeState | undefined>(undefined);

  useEffect(() => {
    if (!webviewRef.current) return;

    const hasChanged = !prevStateRef.current ||
      JSON.stringify(bridgeState) !== JSON.stringify(prevStateRef.current);

    if (hasChanged) {
      prevStateRef.current = bridgeState;
      const script = buildEmitStateScript(bridgeState);
      webviewRef.current.injectJavaScript(script);
    }
  }, [bridgeState]);

  const handleMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      onBridgeMessage?.(event);

      let msg: BridgeCallMessage;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === "console") {
        const consoleMsg = msg as unknown as ConsoleMessage;
        const prefix = `[WebView ${consoleMsg.level}]`;

        switch (consoleMsg.level) {
          case "log":
            console.log(prefix, ...consoleMsg.args);
            break;
          case "warn":
            console.warn(prefix, ...consoleMsg.args);
            break;
          case "error":
            console.error(prefix, ...consoleMsg.args);
            break;
          case "info":
            console.info(prefix, ...consoleMsg.args);
            break;
        }
        return;
      }

      if (msg.type !== "bridge-call") return;

      const { id, method, args } = msg;
      const fn = bridgeMethods[method];

      const sendResponse = (payload: {
        id: string;
        ok: boolean;
        result?: unknown;
        error?: string;
      }) => {
        const script = `
          (function() {
            if (window.__handleBridgeResponse) {
              window.__handleBridgeResponse(${JSON.stringify(payload)});
            }
          })();
          true;
        `;
        webviewRef.current?.injectJavaScript(script);
      };

      if (typeof fn !== "function") {
        sendResponse({
          id,
          ok: false,
          error: `Bridge method "${method}" not found`,
        });
        return;
      }

      try {
        const result = await fn(...(args ?? []));
        sendResponse({ id, ok: true, result: result ?? null });
      } catch (err: unknown) {
        sendResponse({
          id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [bridgeMethods, onBridgeMessage]
  );

  return (
    <WebView
      ref={webviewRef}
      source={source}
      injectedJavaScript={injectedJavaScript}
      onMessage={handleMessage}
      {...rest}
    />
  );
}

export function NativeBridgeWebView<
  S extends BridgeState,
  M extends BridgeMethods
>(props: NativeBridgeProps<S, M>) {
  const { source, bridgeState, bridgeMethods, onBridgeMessage, debug = true, ...rest } = props;

  const webviewRef = useRef<WebView>(null);

  const methodNames = useMemo(
    () => Object.keys(bridgeMethods),
    [bridgeMethods]
  );

  const injectedJavaScript = useMemo(
    () => buildInjectScript(methodNames, bridgeState, debug),
    [methodNames, bridgeState, debug]
  );

  // 이전 상태 추적을 위한 ref
  const prevStateRef = useRef<S | undefined>(undefined);
  
  // RN → Web 상태 브로드캐스트 (변경된 경우만)
  useEffect(() => {
    if (!webviewRef.current) return;
    
    // 얕은 비교로 실제 변경 여부 확인
    const hasChanged = !prevStateRef.current || 
      JSON.stringify(bridgeState) !== JSON.stringify(prevStateRef.current);
    
    if (hasChanged) {
      prevStateRef.current = bridgeState;
      const script = buildEmitStateScript(bridgeState);
      webviewRef.current.injectJavaScript(script);
    }
  }, [bridgeState]);

  const handleMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      onBridgeMessage?.(event);

      let msg: BridgeCallMessage;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === "console") {
        const consoleMsg = msg as unknown as ConsoleMessage;
        const prefix = `[WebView ${consoleMsg.level}]`;
        
        switch (consoleMsg.level) {
          case "log":
            console.log(prefix, ...consoleMsg.args);
            break;
          case "warn":
            console.warn(prefix, ...consoleMsg.args);
            break;
          case "error":
            console.error(prefix, ...consoleMsg.args);
            break;
          case "info":
            console.info(prefix, ...consoleMsg.args);
            break;
        }
        return;
      }
      
      if (msg.type !== "bridge-call") return;

      const { id, method, args } = msg;
      const fn = bridgeMethods[method];

      const sendResponse = (payload: {
        id: string;
        ok: boolean;
        result?: unknown;
        error?: string;
      }) => {
        const script = `
          (function() {
            if (window.__handleBridgeResponse) {
              window.__handleBridgeResponse(${JSON.stringify(payload)});
            }
          })();
          true;
        `;
        webviewRef.current?.injectJavaScript(script);
      };

      if (typeof fn !== "function") {
        sendResponse({
          id,
          ok: false,
          error: `Bridge method "${method}" not found`,
        });
        return;
      }

      try {
        const result = await fn(...(args ?? []));
        sendResponse({ id, ok: true, result: result ?? null });
      } catch (err: unknown) {
        sendResponse({
          id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [bridgeMethods, onBridgeMessage]
  );

  return (
    <WebView
      ref={webviewRef}
      source={source}
      injectedJavaScript={injectedJavaScript}
      onMessage={handleMessage}
      {...rest}
    />
  );
}
