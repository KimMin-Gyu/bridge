/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/electron/bridge.ts
import { contextBridge, ipcRenderer } from "electron";
import type {
  BrowserWindow,
  IpcMain,
} from 'electron'
import type { BridgeStore } from '../../../packages/bridge/src/types'

/** JSON 가능 상태 타입 */
export type BridgeState = Record<string, any>
export type BridgeMethods = Record<string, (...args: any[]) => any | Promise<any>>

// ─────────────────────────────────────────────
// main 프로세스용 - BridgeStore와 호환
// ─────────────────────────────────────────────
export function setupElectronMainBridge<T extends Record<string, any>>(opts: {
  ipcMain: IpcMain
  win: BrowserWindow
  bridge: BridgeStore<T>
  callChannel?: string
  stateChannel?: string
  debug?: boolean
}) {
  const {
    ipcMain,
    win,
    bridge,
    callChannel = 'bridge-call',
    stateChannel = 'bridge-state',
  } = opts

  const getState = () => bridge.getState()

  const broadcastState = () => {
    const state = getState()
    const bridgeState: BridgeState = {}
    const methodNames: string[] = []

    // Separate state and methods
    Object.entries(state).forEach(([key, value]) => {
      if (typeof value === 'function') {
        methodNames.push(key)
      } else {
        bridgeState[key] = value
      }
    })

    win.webContents.send(stateChannel, bridgeState)
  }

  // Subscribe to bridge changes
  bridge.subscribe(() => {
    broadcastState()
  })

  const state = getState()
  const allMethods: Record<string, unknown> = {}
  const methodNames: string[] = []

  // Extract methods from state
  Object.entries(state).forEach(([key, value]) => {
    if (typeof value === 'function') {
      allMethods[key] = value
      methodNames.push(key)
    }
  })

  // Add console method
  allMethods.__console = (...args: unknown[]) => {
    const [level, ...rest] = args
    const prefix = `[WebView ${level}]`

    switch (level) {
      case 'log':
        console.log(prefix, ...rest)
        break
      case 'warn':
        console.warn(prefix, ...rest)
        break
      case 'error':
        console.error(prefix, ...rest)
        break
      case 'info':
        console.info(prefix, ...rest)
        break
      default:
        console.log(prefix, ...rest)
    }
  }

  // ✅ Proxy: 어떤 메서드를 호출하든 끝나면 자동으로 상태 브로드캐스트
  const proxiedMethods = new Proxy(allMethods, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver)
      if (typeof orig !== 'function') return orig

      if (prop === '__console') return orig

      return async (...args: unknown[]) => {
        const result = await orig.apply(target, args)
        broadcastState()
        return result
      }
    },
  })

  ipcMain.handle(callChannel, async (_event, payload) => {
    const { method, args } = payload as { method: string; args: unknown[] }

    const fn = proxiedMethods[method]
    if (typeof fn !== 'function') {
      throw new Error(`Bridge method "${method}" not found`)
    }

    return await fn(...(args ?? []))
  })

  // 초기 메타 주입
  win.webContents.on('did-finish-load', () => {
    const currentState = getState()
    const bridgeState: BridgeState = {}
    const currentMethodNames: string[] = []

    Object.entries(currentState).forEach(([key, value]) => {
      if (typeof value === 'function') {
        currentMethodNames.push(key)
      } else {
        bridgeState[key] = value
      }
    })

    win.webContents
      .executeJavaScript(
        `
      (function() {
        window.__bridgeMethods__ = ${JSON.stringify(currentMethodNames)};
        window.__bridgeState__ = ${JSON.stringify(bridgeState)};
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
    `,
      )
      .catch(err => console.error('[main] inject error', err))

    broadcastState()
  })

  return { broadcastState }
}

export function setupPreload() {
  contextBridge.exposeInMainWorld("__bridgeCall", (method: string, args: unknown[]) => {
    return ipcRenderer.invoke("bridge-call", { method, args });
  });
  
  // 상태 전파 (bridge-state)
  ipcRenderer.on("bridge-state", (_event, state) => {
    window.postMessage(
      {
        type: "bridge-state",
        payload: state,
      },
      "*"
    );
  });
  
}