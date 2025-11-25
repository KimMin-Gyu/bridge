import reactLogo from './assets/react.svg'
import viteLogo from '/electron-vite.animate.svg'
import './App.css'
import { useBridge } from '@repo/bridge/browser'

interface AppBridgeState {
  count: number;
  getCount: () => Promise<number>;
  goToGoogle: () => Promise<void>;
  increase: () => Promise<void>;
  decrease: () => Promise<void>;
}

function App() {
  const { bridge, state, ready } = useBridge<AppBridgeState>({
    debug: true,
  })

  if (!ready) {
    return <div>Loading bridge...</div>
  }

  return (
    <>
      <div>
        <a href="https://electron-vite.github.io" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React + Electron Bridge</h1>
      <div className="card">
        <button onClick={() => bridge.increase()}>
          count is {state.count}
        </button>
        <button onClick={() => bridge.decrease()}>
          Decrease
        </button>
        <button onClick={() => bridge.goToGoogle()}>
          Go to Google
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App
