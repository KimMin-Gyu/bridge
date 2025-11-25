// packages/bridge/browser.tsx
import { useState, useEffect, useSyncExternalStore, useCallback } from "react";
import type { BridgeClient, BridgeMethods, BridgeState } from "./types";

// 싱글톤 전역 스토어
class BridgeStore {
  private state: BridgeState;
  private methods: string[];
  private fallbackMethods: BridgeMethods | null = null;
  private listeners = new Set<() => void>();
  private timeout: number | undefined;
  private debugEnabled = false;
  private originalConsoleMethods: {
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
    info: typeof console.info;
  } | null = null;

  constructor() {
    this.state = (window as Window & { __bridgeState__?: BridgeState }).__bridgeState__ ?? {};
    this.methods = (window as Window & { __bridgeMethods__?: string[] }).__bridgeMethods__ ?? [];
  }

  getState = () => this.state;
  getMethods = () => this.methods;
  getFallbackMethods = () => this.fallbackMethods;
  getTimeout = () => this.timeout;
  isDebugEnabled = () => this.debugEnabled;

  setState(newState: BridgeState) {
    this.state = newState;
    this.notifyListeners();
  }

  setMethods(newMethods: string[]) {
    this.methods = newMethods;
    this.notifyListeners();
  }

  setFallbackMethods(methods: BridgeMethods | null) {
    this.fallbackMethods = methods;
    this.notifyListeners();
  }

  setTimeout(timeout: number | undefined) {
    this.timeout = timeout;
  }

  setDebugEnabled(enabled: boolean) {
    this.debugEnabled = enabled;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach((listener) => listener());
  }

  setupConsoleProxy() {
    if (!this.debugEnabled || !window.__bridgeCall) return;
    if (this.originalConsoleMethods) return;

    this.originalConsoleMethods = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
    };

    (["log", "warn", "error", "info"] as const).forEach((method) => {
      (console as any)[method] = (...args: unknown[]) => {
        this.originalConsoleMethods![method](...args);
        try {
          window.__bridgeCall?.("__console", [method, ...args]);
        } catch {
          // 실패해도 원래 콘솔은 동작
        }
      };
    });
  }

  restoreConsole() {
    if (!this.originalConsoleMethods) return;

    console.log = this.originalConsoleMethods.log;
    console.warn = this.originalConsoleMethods.warn;
    console.error = this.originalConsoleMethods.error;
    console.info = this.originalConsoleMethods.info;

    this.originalConsoleMethods = null;
  }

  cleanup() {
    this.state = {};
    this.methods = [];
    this.fallbackMethods = null;
    this.timeout = undefined;
    this.debugEnabled = false;
    this.restoreConsole();

    // window 전역 상태 정리 (fallback 모드인 경우만)
    const win = window as Window & {
      __bridgeState__?: BridgeState;
      __bridgeMethods__?: string[];
    };

    if (win.__bridgeState__ && !win.__bridgeCall) {
      delete win.__bridgeState__;
    }

    this.notifyListeners();
  }
}

// 싱글톤 인스턴스
const bridgeStore = new BridgeStore();


const proxy = new Proxy(
  {},
  {
    get(_target, prop) {
      const key = String(prop);

      const methods = bridgeStore.getMethods();
      const state = bridgeStore.getState();
      const fallbackMethods = bridgeStore.getFallbackMethods();
      const timeout = bridgeStore.getTimeout();

      const isMethod = methods.includes(key);
      const isStateProp = state && key in state;
      const isFallbackMethod =
        fallbackMethods && typeof fallbackMethods[key] === "function";

      // 1) Host bridge method → RPC 호출
      if (isMethod) {
        return (...args: unknown[]) => {
          if (!window.__bridgeCall) {
            return Promise.reject(
              new Error("bridgeCall not available (no host attached)")
            );
          }

          // __bridgeCall 시그니처가 timeout을 지원하는지 확인
          const timeoutValue = timeout || 30000;

          // 개선된 __bridgeCall 호출 (timeout 전달)
          if (window.__bridgeCall.length >= 3) {
            return window.__bridgeCall(key, args, timeoutValue) as Promise<unknown>;
          }

          // 레거시 지원 - 기존 방식으로 fallback
          const promise = window.__bridgeCall(key, args) as Promise<unknown>;

          if (timeout) {
            // timeout 타이머 누수 방지: promise가 완료되면 타이머를 clear
            let timeoutId: ReturnType<typeof setTimeout>;

            return Promise.race([
              promise.finally(() => clearTimeout(timeoutId)),
              new Promise((_, reject) => {
                timeoutId = setTimeout(
                  () =>
                    reject(
                      new Error(
                        `Bridge method '${key}' timed out (${timeout}ms)`
                      )
                    ),
                  timeout
                );
              }),
            ]);
          }

          return promise;
        };
      }

      // 2) fallback method
      if (isFallbackMethod) {
        return (...args: unknown[]) => {
          const fn = fallbackMethods![key];
          return fn(...args);
        };
      }

      // 3) state property
      if (isStateProp) {
        return state[key];
      }

      // 4) 모르는 key → undefined (에러 X)
      return undefined;
    },

    set() {
      console.warn("Bridge state is read-only on web");
      return false;
    },
  }
);

export const bridgeClient =
  proxy as BridgeClient<BridgeState, BridgeMethods>;

export interface UseBridgeOptions<
  S extends BridgeState,
  M extends BridgeMethods,
> {
  /** 호스트가 응답하지 않을 경우 타이머 시간 */
  timeout?: number;
  /** 디버깅 플래그 true일 경우 웹에서의 console.log가 네이티브로 전달 */
  debug?: boolean;
  /** 호스트가 없을 때 기본으로 쓸 초기 상태 */
  initialState?: S;
  /** 호스트가 없을 때 사용할 fallback 메서드 구현 */
  fallbackMethods?: Partial<M>;
  /**
   * 호스트가 없어도 fallback만 있으면 ready=true 로 처리할지 여부
   * @default true
   */
  treatFallbackAsReady?: boolean;
}

export function useBridge<
  S extends BridgeState,
  M extends BridgeMethods
>(options: UseBridgeOptions<S, M> = {}) {
  const {
    timeout = 5_000,
    debug = false,
    initialState,
    fallbackMethods,
    treatFallbackAsReady = true,
  } = options;

  const [ready, setReady] = useState<boolean>(() => {
    // 호스트가 이미 주입된 경우
    if (window.__bridgeCall && window.__bridgeMethods__) return true;

    // 호스트는 없지만 fallback을 쓸 경우
    if (fallbackMethods || initialState) {
      return treatFallbackAsReady !== false;
    }

    return false;
  });

  const [mode, setMode] = useState<"none" | "host" | "fallback">("none");

  // useSyncExternalStore로 state 구독
  const state = useSyncExternalStore(
    useCallback((callback) => bridgeStore.subscribe(callback), []),
    useCallback(() => bridgeStore.getState() as S, []),
    useCallback(() => (initialState ?? {}) as S, [initialState])
  );

  // timeout 설정
  useEffect(() => {
    bridgeStore.setTimeout(timeout);
    return () => {
      bridgeStore.setTimeout(undefined);
    };
  }, [timeout]);

  // debug + console proxy
  useEffect(() => {
    bridgeStore.setDebugEnabled(debug);
    if (debug && ready) {
      bridgeStore.setupConsoleProxy();
    }

    return () => {
      bridgeStore.setDebugEnabled(false);
      bridgeStore.restoreConsole();
    };
  }, [debug, ready]);

  // host / fallback 모드 결정 + RN/Electron용 이벤트 처리 + 폴링
  useEffect(() => {
    const syncFromWindow = () => {
      const methods = (window as Window & { __bridgeMethods__?: string[] }).__bridgeMethods__;
      const windowState = (window as Window & { __bridgeState__?: BridgeState }).__bridgeState__;

      if (methods && Array.isArray(methods)) {
        bridgeStore.setMethods(methods);
      }
      if (windowState && typeof windowState === "object") {
        bridgeStore.setState(windowState);
      }
    };

    const activateHostModeIfAvailable = () => {
      if (window.__bridgeCall && window.__bridgeMethods__) {
        setMode("host");
        setReady(true);
        syncFromWindow();
        return true;
      }
      return false;
    };

    const setupFallbackIfNeeded = () => {
      // 이미 host 모드면 fallback 세팅할 필요 없음
      if (mode === "host") return;

      if (!initialState && !fallbackMethods) return;

      if (initialState && typeof initialState === "object") {
        bridgeStore.setState(initialState);
        (window as Window & { __bridgeState__?: BridgeState }).__bridgeState__ = initialState;
      }

      if (fallbackMethods) {
        bridgeStore.setFallbackMethods(fallbackMethods as BridgeMethods);
      }

      setMode("fallback");

      if (treatFallbackAsReady !== false) {
        setReady(true);
      }
    };

    const handleStateChange = () => {
      // 호스트가 상태를 push 해주는 이벤트
      if (activateHostModeIfAvailable()) return;
      syncFromWindow();
    };

    const handleReady = () => {
      // 호스트가 bridge-ready 이벤트를 쏜 경우
      if (activateHostModeIfAvailable()) return;
      setReady(true);
      syncFromWindow();
    };

    // 진입 시 한 번 현재 window 상태 동기화
    syncFromWindow();

    if (!activateHostModeIfAvailable()) {
      // 호스트가 없으면 fallback 세팅
      setupFallbackIfNeeded();
    }

    window.addEventListener("bridgeStateChange", handleStateChange as any);
    window.addEventListener("bridge-ready", handleReady as any);

    // event 타이밍 놓친 경우 대비 폴링 (최대 N번만 시도)
    const MAX_TRIES = 500; // 500 * 20ms = 10초 정도
    let tries = 0;
    let isCleanedUp = false; // cleanup 추적 플래그

    const id = setInterval(() => {
      // cleanup이 호출된 경우 즉시 중단
      if (isCleanedUp) {
        clearInterval(id);
        return;
      }

      if (window.__bridgeCall && window.__bridgeMethods__) {
        if (!ready) {
          setReady(true);
          syncFromWindow();
          if (bridgeStore.isDebugEnabled()) {
            bridgeStore.setupConsoleProxy();
          }
        } else {
          syncFromWindow();
        }
        clearInterval(id);
        return;
      }

      tries += 1;
      if (tries >= MAX_TRIES) {
        if (bridgeStore.isDebugEnabled()) {
          console.warn(
            "[bridge] host not detected within timeout; current mode:",
            mode
          );
        }
        clearInterval(id);
      } else if (bridgeStore.isDebugEnabled()) {
        console.log("[bridge] polling...", tries);
      }
    }, 20);

    return () => {
      isCleanedUp = true;
      clearInterval(id);
      window.removeEventListener(
        "bridgeStateChange",
        handleStateChange as any
      );
      window.removeEventListener("bridge-ready", handleReady as any);

      // fallback methods 참조 정리
      if (mode === "fallback") {
        bridgeStore.setFallbackMethods(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(initialState),
    JSON.stringify(fallbackMethods),
    treatFallbackAsReady,
  ]);

  // 🟦 Electron preload → renderer postMessage 브리지
  useEffect(() => {
    const handleElectronMessage = (e: MessageEvent) => {
      if (e.data?.type === "bridge-state") {
        const newState = e.data.payload;
        bridgeStore.setState(newState);
        (window as Window & { __bridgeState__?: BridgeState }).__bridgeState__ = newState;

        const ev = new CustomEvent("bridgeStateChange", {
          detail: newState,
        });
        window.dispatchEvent(ev);
      }

      if (e.data?.type === "bridge-ready") {
        setReady(true);

        if (e.data.methods) {
          bridgeStore.setMethods(e.data.methods);
        }
        if (e.data.state) {
          bridgeStore.setState(e.data.state);
          (window as Window & { __bridgeState__?: BridgeState }).__bridgeState__ = e.data.state;
        }

        const ev = new Event("bridge-ready");
        window.dispatchEvent(ev);
      }
    };

    window.addEventListener("message", handleElectronMessage);
    return () =>
      window.removeEventListener("message", handleElectronMessage);
  }, []);

  return {
    bridge: bridgeClient as unknown as BridgeClient<S, M>,
    state,
    ready,
    mode,
  };
}
