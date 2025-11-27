// apps/electron/main.ts
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { setupElectronMainBridge } from './bridge'
import { createBridge } from '@repo/bridge/electron'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')


export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null

interface AppBridgeState {
  count: number;
  getCount: () => Promise<number>;
  goToGoogle: () => Promise<void>;
  increase: () => Promise<void>;
  decrease: () => Promise<void>;
  sum: (nums: number[]) => Promise<number>;
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      webviewTag: true,
    },
  })

  // ✅ createBridge를 사용하여 브릿지 생성
  const appBridge = createBridge<AppBridgeState>((get, set) => ({
    count: 0,
    getCount: async () => {
      return get().count
    },
    increase: async () => {
      set({ count: get().count + 1 })
    },
    decrease: async () => {
      set({ count: get().count - 1 })
    },
    goToGoogle: async () => {
      await shell.openExternal('https://www.google.com')
    },
    sum: async (nums: number[]) => {
      return nums.reduce((acc, num) => acc + num, 0)
    }
  }))

  setTimeout(() => {
    appBridge.setState({ count: 10 })
  }, 5000)

  // ✅ 브릿지 먼저 세팅
  setupElectronMainBridge({
    ipcMain,
    win,
    bridge: appBridge,
    debug: true, // Set to false to disable console forwarding
  })

  // 그냥 테스트 메세지
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    // win.loadURL(VITE_DEV_SERVER_URL)
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(process.env.APP_ROOT, 'dist/index.html'))
  }

}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(createWindow)
