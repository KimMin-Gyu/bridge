"use strict";
const electron = require("electron");
function setupPreload() {
  electron.contextBridge.exposeInMainWorld("__bridgeCall", (method, args) => {
    return electron.ipcRenderer.invoke("bridge-call", { method, args });
  });
  electron.ipcRenderer.on("bridge-state", (_event, state) => {
    window.postMessage(
      {
        type: "bridge-state",
        payload: state
      },
      "*"
    );
  });
}
setupPreload();
