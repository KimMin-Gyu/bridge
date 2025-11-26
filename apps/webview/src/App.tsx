import { createWebBridge, useWebBridge } from '@repo/bridge/browser'
import { useState } from 'react'

interface AppBridgeState {
  count: number
  getCount: () => Promise<number>
  increase: () => Promise<void>
  decrease: () => Promise<void>
  goToGoogle: () => Promise<void>
  sum: (a: number, b: number) => Promise<number>
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
    sum: async (a: number, b: number) => {
      console.log('FALLBACK sum called', a, b)
      return 0
    },
  }),
  {
    debug: false,
    timeout: 1000
  }
)

function App() {  
  const bridge = useWebBridge(webBridge)

  const [a, setA] = useState(0)
  const [b, setB] = useState(0)

  return (
    <div>
      <span>
        Count: {bridge.count}
      </span>
      <button onClick={() => {
        console.log('INCREASE called')
        bridge.increase()
      }}>
        Increase
      </button>
      <button onClick={() => {
        console.log('DECREASE called')
        bridge.decrease()
      }}>
        Decrease
      </button>
      <button onClick={() => bridge.goToGoogle()}>
        Go to Google
      </button>
      <button onClick={async () => {
        try {
          const result = await bridge.sum(a, b)
          alert(`Sum result: ${result}`)
        } catch (error) {
          alert(`Error: ${error}`)
        }
      }}>
        Sum
      </button>
      <input type="number" value={a} onChange={(e) => setA(Number(e.target.value))} />
      <input type="number" value={b} onChange={(e) => setB(Number(e.target.value))} />
    </div>
  )
}


export default App