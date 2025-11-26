"use strict";
const electron = require("electron");
function setupPreload() {
  electron.contextBridge.exposeInMainWorld("__bridgeCall", (method, args) => {
    console.log("[Preload] __bridgeCall invoked:", method, args);
    return electron.ipcRenderer.invoke("bridge-call", { method, args });
  });
  electron.contextBridge.exposeInMainWorld("__onBridgeState", (callback) => {
    electron.ipcRenderer.on("bridge-state", (_event, state) => {
      console.log("[Preload] Forwarding bridge-state to renderer:", state);
      callback(state);
    });
  });
}
setupPreload();
