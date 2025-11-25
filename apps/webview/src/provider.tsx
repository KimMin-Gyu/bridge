// import { createContext, useContext } from "react"
// import { useBrowserBridge } from "@repo/bridge/browser"
// import { BridgeClient } from "@repo/bridge/types"

// interface BridgeState {
//   count: number
//   [key: string]: unknown
// }

// interface BridgeMethods {
//   getCount: () => Promise<number>
//   increase: () => Promise<void>
//   decrease: () => Promise<void>
//   goToGoogle: () => Promise<void>
//   [key: string]: (...args: unknown[]) => Promise<unknown>
// }

// interface BridgeContextType {
//   state: BridgeState
//   bridge: BridgeClient<BridgeState, BridgeMethods>
// }

// const BridgeContext = createContext<BridgeContextType | undefined>(undefined)

// export const BridgeProvider = ({ children }: { children: React.ReactNode }) => {
//   const bridgeProps = useBrowserBridge<BridgeState, BridgeMethods>({
//     initialState: { count: 0 },
//     fallbackMethods: {},
//   })

//   return (
//     <BridgeContext.Provider value={{ ...bridgeProps }}>
//       {children}
//     </BridgeContext.Provider>
//   )
// }

// export const useBridge = () => {
//   const context = useContext(BridgeContext)

//   if (!context) {
//     throw new Error("useBridge must be used within a BridgeProvider")
//   }

//   return context
// }