// packages/bridge/browser.tsx
import { useEffect, useState } from "react";
import type { BridgeClient, BridgeMethods, BridgeState } from "./types";

let internalState: BridgeState = (window as Window & { __bridgeState__?: BridgeState }).__bridgeState__ ?? {};
let internalMethods: string[] = (window as Window & { __bridgeMethods__?: string[] }).__bridgeMethods__ ?? [];
let globalTimeout: number | undefined;
let debugEnabled = false;
let internalFallbackMethods: BridgeMethods | null = null;

function setupConsoleProxy() {
  if (!debugEnabled || !window.__bridgeCall) return;

  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
  };

  (["log", "warn", "error", "info"] as const).forEach((method) => {
    (console as any)[method] = (...args: unknown[]) => {
      originalConsole[method](...args);

      try {
        window.__bridgeCall?.("__console", [method, ...args]);
      } catch {
        // 실패해도 원래 콘솔은 동작
      }
    };
  });
}

// RN / Electron 호스트가 쏘는 커스텀 이벤트로 상태 업데이트
window.addEventListener("bridgeStateChange", (e: Event) => {
  const detail = (e as CustomEvent<BridgeState>).detail;
  internalState = detail;
});

const proxy = new Proxy(
  {},
  {
    get(_target, prop) {
      const key = String(prop);

      const isMethod = internalMethods.includes(key);
      const isStateProp = internalState && key in internalState;

      const isFallbackMethod =
        internalFallbackMethods &&
        typeof internalFallbackMethods[key] === "function";

      // 1) Host bridge method → RPC 호출
      if (isMethod) {
        return (...args: unknown[]) => {
          if (!window.__bridgeCall) {
            return Promise.reject(
              new Error("bridgeCall not available (no host attached)")
            );
          }

          // __bridgeCall 시그니처가 timeout을 지원하는지 확인
          const timeout = globalTimeout || 30000;
          
          // 개선된 __bridgeCall 호출 (timeout 전달)
          if (window.__bridgeCall.length >= 3) {
            return window.__bridgeCall(key, args, timeout) as Promise<unknown>;
          }
          
          // 레거시 지원 - 기존 방식으로 fallback
          const promise = window.__bridgeCall(key, args) as Promise<unknown>;
          
          if (globalTimeout) {
            return Promise.race([
              promise,
              new Promise((_, reject) =>
                setTimeout(
                  () =>
                    reject(
                      new Error(
                        `Bridge method '${key}' timed out (${globalTimeout}ms)`
                      )
                    ),
                  globalTimeout
                )
              ),
            ]);
          }

          return promise;
        };
      }

      // 2) fallback method
      if (isFallbackMethod) {
        return (...args: unknown[]) => {
          const fn = internalFallbackMethods[key];
          return fn(...args);
        };
      }

      // 3) state property
      if (isStateProp) {
        return internalState[key];
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
  timeout?: number;
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

  const [, setTick] = useState(0);

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

  // timeout 전역 설정
  useEffect(() => {
    globalTimeout = timeout;
    return () => {
      globalTimeout = undefined;
    };
  }, [timeout]);

  // debug + console proxy
  useEffect(() => {
    debugEnabled = !!debug;
    if (debugEnabled && ready) {
      setupConsoleProxy();
    }
  }, [debug, ready]);

  // host / fallback 모드 결정 + RN/Electron용 이벤트 처리 + 폴링
  useEffect(() => {
    const syncFromWindow = () => {
      const methods = (window as Window & { __bridgeMethods__?: string[] }).__bridgeMethods__;
      const state = (window as Window & { __bridgeState__?: BridgeState }).__bridgeState__;

      if (methods && Array.isArray(methods)) {
        internalMethods = methods;
      }
      if (state && typeof state === "object") {
        internalState = state;
      }

      setTick((prev) => prev + 1);
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
        internalState = initialState;
        (window as Window & { __bridgeState__?: BridgeState }).__bridgeState__ = initialState;
      }

      if (fallbackMethods) {
        internalFallbackMethods = fallbackMethods as BridgeMethods;
      }

      setMode("fallback");

      if (treatFallbackAsReady !== false) {
        setReady(true);
      }

      setTick((prev) => prev + 1);
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

    const id = setInterval(() => {
      if (window.__bridgeCall && window.__bridgeMethods__) {
        if (!ready) {
          setReady(true);
          syncFromWindow();
          if (debugEnabled) setupConsoleProxy();
        } else {
          syncFromWindow();
        }
        clearInterval(id);
        return;
      }

      tries += 1;
      if (tries >= MAX_TRIES) {
        if (debugEnabled) {
          console.warn(
            "[bridge] host not detected within timeout; current mode:",
            mode
          );
        }
        clearInterval(id);
      } else if (debugEnabled) {
        console.log("[bridge] polling...", tries);
      }
    }, 20);

    return () => {
      clearInterval(id);
      window.removeEventListener(
        "bridgeStateChange",
        handleStateChange as any
      );
      window.removeEventListener("bridge-ready", handleReady as any);
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
        internalState = e.data.payload;
        (window as Window & { __bridgeState__?: BridgeState }).__bridgeState__ = internalState;

        const ev = new CustomEvent("bridgeStateChange", {
          detail: internalState,
        });
        window.dispatchEvent(ev);
      }

      if (e.data?.type === "bridge-ready") {
        setReady(true);

        if (e.data.methods) internalMethods = e.data.methods;
        if (e.data.state) {
          internalState = e.data.state;
          (window as Window & { __bridgeState__?: BridgeState }).__bridgeState__ = internalState;
        }

        const ev = new Event("bridge-ready");
        window.dispatchEvent(ev);
      }
    };

    window.addEventListener("message", handleElectronMessage);
    return () =>
      window.removeEventListener("message", handleElectronMessage);
  }, []);

  const state = (window as Window & { __bridgeState__?: BridgeState }).__bridgeState__ as S | undefined;

  return {
    bridge: bridgeClient as unknown as BridgeClient<S, M>,
    state,
    ready,
    mode,
  };
}
