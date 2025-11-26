import { appBridge } from "@/bridge/bridge";
import { useBridge } from "../lib/bridge-core";
import { View, Text, Button, SafeAreaView } from "react-native";

export default function Second() {
  const bridge = useBridge(appBridge);

  return (
    <SafeAreaView>
      <Text>Second</Text>
      <Text>Count: {bridge.count}</Text>
      <Button title="Increase" onPress={() => bridge.increase()} />
      <Button title="Decrease" onPress={() => bridge.decrease()} />
    </SafeAreaView>
  )
}