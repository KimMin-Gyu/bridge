import { useAppBridge } from "@/bridge/bridge";
import { View, Text, Button } from "react-native";

export default function Second() {
  const bridge = useAppBridge();

  return (
    <View>
      <Text>Second</Text>
      <Text>Count: {bridge.count}</Text>
      <Button title="Increase" onPress={() => bridge.increase()} />
      <Button title="Decrease" onPress={() => bridge.decrease()} />
    </View>
  )
}