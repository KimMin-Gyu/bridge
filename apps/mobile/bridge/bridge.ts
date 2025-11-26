import { Linking } from "react-native";
import { createBridge } from "../lib/bridge-core";

interface Bridge {
  count: number;
  getCount: () => Promise<number>;
  goToGoogle: () => Promise<void>;
  increase: () => Promise<void>;
  decrease: () => Promise<void>;  
}

export const appBridge = createBridge<Bridge>((get, set) => ({
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
    set({ count: get().count - 1 });
  },
  sum: async (a: number, b: number) => {
    return a + b;
  },
}));
