import { Button, Text, View, SafeAreaView } from "react-native";
import { BridgeWebView, useBridge } from "../lib/bridge-core";
import { router } from "expo-router";
import { appBridge } from "@/bridge/bridge";

export default function Second() {
  const { count, increase, decrease } = useBridge(appBridge);

  return (
    <SafeAreaView
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Text>Second: {count}</Text>
      <Button title="Increase" onPress={() => increase()} />
      <Button title="Decrease" onPress={() => decrease()} />
      <View style={{ flex: 1, width: "100%", height: "100%" }}>
        <BridgeWebView
          source={{ uri: "http://localhost:5173" }}
          bridge={appBridge}
        />
      </View>
    </SafeAreaView>
  );
}
