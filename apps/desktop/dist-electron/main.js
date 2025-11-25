import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
function setupElectronMainBridge(opts) {
  const {
    ipcMain: ipcMain2,
    win: win2,
    methods,
    getState,
    callChannel = "bridge-call",
    stateChannel = "bridge-state"
  } = opts;
  // 디바운스를 위한 변수
  let broadcastTimeout = null;
  let lastState = null;
  
  // 얕은 비교로 변경된 필드만 체크
  const hasStateChanged = (newState, oldState) => {
    if (!oldState) return true;
    if (typeof newState !== 'object' || typeof oldState !== 'object') {
      return newState !== oldState;
    }
    
    const newKeys = Object.keys(newState);
    const oldKeys = Object.keys(oldState);
    
    if (newKeys.length !== oldKeys.length) return true;
    
    for (const key of newKeys) {
      if (newState[key] !== oldState[key]) {
        return true;
      }
    }
    
    return false;
  };
  
  const broadcastState = (force = false) => {
    // 디바운스 처리 - 짧은 시간 내 연속 호출 방지
    if (broadcastTimeout && !force) {
      clearTimeout(broadcastTimeout);
    }
    
    broadcastTimeout = setTimeout(() => {
      const state = getState();
      
      // 얕은 비교로 실제 변경 여부 확인
      if (!hasStateChanged(state, lastState) && !force) {
        broadcastTimeout = null;
        return;
      }
      
      lastState = { ...state }; // shallow copy
      lastStateSnapshot = JSON.stringify(state);
      win2.webContents.send(stateChannel, state);
      broadcastTimeout = null;
    }, force ? 0 : 16); // 16ms 디바운스 (60fps 기준)
  };
  const allMethods = {
    ...methods,
    ...{
      __console: (...args) => {
        console.log("[main] __console:", args);
        const [level, ...rest] = args;
        const prefix = `[WebView ${level}]`;
        switch (level) {
          case "log":
            console.log(prefix, ...rest);
            break;
          case "warn":
            console.warn(prefix, ...rest);
            break;
          case "error":
            console.error(prefix, ...rest);
            break;
          case "info":
            console.info(prefix, ...rest);
            break;
          default:
            console.log(prefix, ...rest);
        }
      }
    }
  };
  // 상태 변경을 추적하기 위한 변수
  let lastStateSnapshot = JSON.stringify(getState());
  
  const proxiedMethods = new Proxy(allMethods, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== "function") return orig;
      if (prop === "__console") return orig;
      
      return async (...args) => {
        const prevState = JSON.stringify(getState());
        const result = await orig.apply(target, args);
        
        // 메서드에서 명시적으로 상태 변경을 알리는 경우 체크
        const shouldBroadcast = result && typeof result === 'object' && result.__bridgeStateChanged === true;
        
        if (shouldBroadcast) {
          // 명시적 상태 변경 신호
          broadcastState(true); // 강제 broadcast
        } else {
          // 상태가 실제로 변경된 경우에만 broadcast
          const currentState = JSON.stringify(getState());
          if (currentState !== prevState) {
            broadcastState();
          }
        }
        
        // __bridgeStateChanged 메타데이터 제거 후 반환
        if (result && typeof result === 'object' && '__bridgeStateChanged' in result) {
          const { __bridgeStateChanged, ...cleanResult } = result;
          return cleanResult;
        }
        
        return result;
      };
    }
  });
  ipcMain2.handle(callChannel, async (_event, payload) => {
    const { method, args } = payload;
    const fn = proxiedMethods[method];
    if (typeof fn !== "function") {
      throw new Error(`Bridge method "${method}" not found`);
    }
    return await fn(...args ?? []);
  });
  win2.webContents.on("did-finish-load", () => {
    const state = getState();
    const methodNames = Object.keys(methods);
    win2.webContents.executeJavaScript(
      `
      (function() {
        window.__bridgeMethods__ = ${JSON.stringify(methodNames)};
        window.__bridgeState__ = ${JSON.stringify(state)};
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
    `
    ).catch((err) => console.error("[main] inject error", err));
    broadcastState();
  });
  return { broadcastState };
}
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      webviewTag: true
    }
  });
  let count = 0;
  const methods = {
    async getCount() {
      return count;
    },
    async increase() {
      count += 1;
    },
    async decrease() {
      count -= 1;
    },
    async goToGoogle() {
      win == null ? void 0 : win.webContents.loadURL("https://www.google.com");
    }
  };
  function getState() {
    return { count };
  }
  setupElectronMainBridge({
    ipcMain,
    win,
    methods,
    getState
  });
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(process.env.APP_ROOT, "dist/index.html"));
  }
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.whenReady().then(createWindow);
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
