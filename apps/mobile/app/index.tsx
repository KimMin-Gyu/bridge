import { useState,  useEffect } from "react";
import { Button, Text, View, Linking } from "react-native";
import { NativeBridgeWebView } from "../lib/bridge";

export default function Index() {
  const [count, setCount] = useState(0);

  const bridgeState = { count };

  const bridgeMethods = {
    async getCount() {
      return count;
    },
    async goToGoogle() {
      await Linking.openURL("https://www.google.com");
    },
    async increase() {
      setCount((prev) => prev + 1);
    },
    async decrease() {
      setCount((prev) => prev - 1);
    },
  }

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Text>Native: {count}</Text>
      <Button title="Increase" onPress={() => bridgeMethods.increase()} />
      <Button title="Decrease" onPress={() => bridgeMethods.decrease()} />
      <View style={{ flex: 1, width: "100%", height: "100%" }}>
      <NativeBridgeWebView
        source={{ uri: "http://localhost:5173" }}
        bridgeState={bridgeState}
        bridgeMethods={bridgeMethods}
      />      
      </View>
    </View>
  );
}
