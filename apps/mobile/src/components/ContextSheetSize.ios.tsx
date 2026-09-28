import { requireNativeView } from "expo";
import type { ViewProps } from "react-native";

const NativeSheetSize = requireNativeView<ViewProps & { contentHeight: number }>(
  "E6NativeControls",
  "ContextSheetSize",
);

export function ContextSheetSize({ height }: { height: number }) {
  return (
    <NativeSheetSize
      contentHeight={height}
      pointerEvents="none"
      style={{ position: "absolute", width: 0, height: 0 }}
    />
  );
}
