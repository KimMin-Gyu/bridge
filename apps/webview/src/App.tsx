import { createWebBridge, useWebBridge } from '@repo/bridge/browser'

interface AppBridgeState {
  count: number
  getCount: () => Promise<number>
  increase: () => Promise<void>
  decrease: () => Promise<void>
  goToGoogle: () => Promise<void>
}

const webBridge = createWebBridge<AppBridgeState>(
  (get, set) => ({
    count: 0,
    getCount: async () => {
      return get().count
    },
    increase: async () => {
      console.log('FALLBACK increase called')
      set({ count: get().count + 1 })
    },
    decrease: async () => {
      console.log('FALLBACK decrease called')
      set({ count: get().count - 1 })
    },
    goToGoogle: async () => {
      console.log('FALLBACK goToGoogle called')
      window.open('https://www.google.com', '_blank')
    },
  }),
  {
    debug: true,
  }
)

function App() {  
  const bridge = useWebBridge<AppBridgeState>(webBridge)
  
  return (
    <div>
      <span>
        Count: {bridge.count}
      </span>
      <button onClick={() => bridge.increase()}>
        Increase
      </button>
      <button onClick={() => bridge.decrease()}>
        Decrease
      </button>
      <button onClick={() => bridge.goToGoogle()}>
        Go to Google
      </button>
    </div>
  )
}


export default App