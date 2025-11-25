import { Linking, Button, Text, View } from "react-native";
import { createBridge, useBridge, BridgeWebView } from "../lib/bridge";

interface AppBridgeState {
  count: number;
  getCount: () => Promise<number>;
  goToGoogle: () => Promise<void>;
  increase: () => Promise<void>;
  decrease: () => Promise<void>;
}

const appBridge = createBridge<AppBridgeState>((get, set) => ({
  count: 0,
  getCount: async () => {
    return get().count;
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
}));

export default function Index() {
  const { count, increase, decrease } = useBridge(appBridge);

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Text>Native: {count}</Text>
      <Button title="Increase" onPress={() => increase()} />
      <Button title="Decrease" onPress={() => decrease()} />
      <View style={{ flex: 1, width: "100%", height: "100%" }}>
        <BridgeWebView
          source={{ uri: "http://localhost:5173" }}
          bridge={appBridge}
        />
      </View>
    </View>
  );
}
