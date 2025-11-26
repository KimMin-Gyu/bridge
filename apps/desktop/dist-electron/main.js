import { app, BrowserWindow, shell, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
function setupElectronMainBridge(opts) {
  const {
    ipcMain: ipcMain2,
    win: win2,
    bridge,
    callChannel = "bridge-call",
    stateChannel = "bridge-state"
  } = opts;
  const getState = () => bridge.getState();
  const broadcastState = () => {
    const state2 = getState();
    const bridgeState = {};
    Object.entries(state2).forEach(([key, value]) => {
      if (typeof value === "function") ;
      else {
        bridgeState[key] = value;
      }
    });
    win2.webContents.send(stateChannel, bridgeState);
  };
  bridge.subscribe(() => {
    broadcastState();
  });
  const state = getState();
  const allMethods = {};
  Object.entries(state).forEach(([key, value]) => {
    if (typeof value === "function") {
      allMethods[key] = value;
    }
  });
  allMethods.__console = (...args) => {
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
  };
  const proxiedMethods = new Proxy(allMethods, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== "function") return orig;
      if (prop === "__console") return orig;
      return async (...args) => {
        const result = await orig.apply(target, args);
        broadcastState();
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
    const currentState = getState();
    const bridgeState = {};
    const currentMethodNames = [];
    Object.entries(currentState).forEach(([key, value]) => {
      if (typeof value === "function") {
        currentMethodNames.push(key);
      } else {
        bridgeState[key] = value;
      }
    });
    win2.webContents.executeJavaScript(
      `
      (function() {
        window.__bridgeMethods__ = ${JSON.stringify(currentMethodNames)};
        window.__bridgeState__ = ${JSON.stringify(bridgeState)};

        // Setup console proxy to forward logs to main process
        var originalConsole = {
          log: console.log.bind(console),
          warn: console.warn.bind(console),
          error: console.error.bind(console),
          info: console.info.bind(console)
        };

        ['log', 'warn', 'error', 'info'].forEach(function(method) {
          console[method] = function() {
            var args = Array.prototype.slice.call(arguments);
            originalConsole[method].apply(console, args);

            if (window.__bridgeCall) {
              window.__bridgeCall('__console', [method].concat(args)).catch(function() {});
            }
          };
        });

        // Setup state listener if available
        if (window.__onBridgeState) {
          window.__onBridgeState(function(state) {
            window.__bridgeState__ = state;

            // Dispatch custom event
            var ev;
            try {
              ev = new CustomEvent("bridgeStateChange", { detail: state });
            } catch (_) {
              ev = document.createEvent("CustomEvent");
              ev.initCustomEvent("bridgeStateChange", true, true, state);
            }
            window.dispatchEvent(ev);
          });
        } else {
          console.error('[Renderer] __onBridgeState not available!');
        }

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
function createBridge(createState) {
  let state = {};
  const listeners = /* @__PURE__ */ new Set();
  const get = () => state;
  const set = (partial) => {
    const nextState = typeof partial === "function" ? partial(state) : partial;
    state = { ...state, ...nextState };
    listeners.forEach((listener) => listener(state));
  };
  state = createState(get, set);
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getState = () => state;
  const setState = set;
  const store = new Proxy({}, {
    get(target, prop) {
      if (prop === "getState") return getState;
      if (prop === "setState") return setState;
      if (prop === "subscribe") return subscribe;
      const currentState = getState();
      return currentState[prop];
    },
    set(target, prop, value) {
      if (prop === "getState" || prop === "setState" || prop === "subscribe") {
        return false;
      }
      state[prop] = value;
      return true;
    }
  });
  return store;
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
  const appBridge = createBridge((get, set) => ({
    count: 0,
    getCount: async () => {
      return get().count;
    },
    increase: async () => {
      set({ count: get().count + 1 });
    },
    decrease: async () => {
      set({ count: get().count - 1 });
    },
    goToGoogle: async () => {
      await shell.openExternal("https://www.google.com");
    },
    sum: async (a, b) => {
      await new Promise((resolve) => setTimeout(resolve, 4e3));
      const result = a + b;
      return result;
    }
  }));
  setupElectronMainBridge({
    ipcMain,
    win,
    bridge: appBridge
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
