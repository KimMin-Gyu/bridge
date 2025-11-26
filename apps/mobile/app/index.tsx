import { Button, Text, View, SafeAreaView } from "react-native";
import { BridgeWebView } from "../lib/bridge";
import { router } from "expo-router";
import { bridge, useAppBridge } from "@/bridge/bridge";

export default function Index() {
  const { count, increase, decrease } = useAppBridge();

  return (
    <SafeAreaView
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Text>Native: {count}</Text>
      <Button title="Increase" onPress={() => increase()} />
      <Button title="Decrease" onPress={() => decrease()} />
      <Button title="Go to Second" onPress={() => router.push("/second")} />
      <View style={{ flex: 1, width: "100%", height: "100%" }}>
        <BridgeWebView
          source={{ uri: "http://localhost:5173" }}
          bridge={bridge}
        />
      </View>
    </SafeAreaView>
  );
}
