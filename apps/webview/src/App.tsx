import { useBridge } from '@repo/bridge/browser'
import { useEffect } from 'react'

interface BridgeState {
  count: number
  [key: string]: unknown
}

interface BridgeMethods {
  getCount: () => Promise<number>
  increase: () => Promise<void>
  decrease: () => Promise<void>
  goToGoogle: () => Promise<void>
  [key: string]: (...args: unknown[]) => Promise<unknown>
}

function App() {  
  useEffect(() => {
    setTimeout(() => {
      console.log('state', state)
    }, 5000)
  }, [])

  const { state, bridge } = useBridge<BridgeState, BridgeMethods>({
    initialState: { count: 0 },
    fallbackMethods: {
      getCount: async () => 0,
      increase: async () => {
        alert('override')
      },
      decrease: async () => {
        alert('override')
      },
      goToGoogle: async () => {
        alert('override')
      },
    },
  })
  
  return (
    <div>
      <span>
        Count: {state?.count}
      </span>
      <button onClick={() => bridge?.increase()}>
        Increase
      </button>
      <button onClick={() => bridge?.decrease()}>
        Decrease
      </button>
      <button onClick={() => bridge?.goToGoogle()}>
        Go to Google
      </button>
    </div>
  )
}


export default App