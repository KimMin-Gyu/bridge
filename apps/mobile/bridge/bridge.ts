import { Linking } from "react-native";
import { createBridge, useBridge } from "../lib/bridge";

interface Bridge {
  count: number;
  getCount: () => Promise<number>;
  goToGoogle: () => Promise<void>;
  increase: () => Promise<void>;
  decrease: () => Promise<void>;  
}

export const bridge = createBridge<Bridge>((get, set) => ({
  count: 0,
  getCount: async () => {
    return 0;
  },
  goToGoogle: async () => {
    await Linking.openURL("https://www.google.com");
  },
  increase: async () => {
    set({ count: get().count + 1 });
  },
  decrease: async () => {
    console.log('DECREASE called', get().count)
    set({ count: get().count - 1 });
  },
  sum: async (a: number, b: number) => {
    await new Promise(resolve => setTimeout(resolve, 4000))
    return a + b;
  },
}));

export const useAppBridge = () => useBridge(bridge);