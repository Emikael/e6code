import type { ReactNode } from "react";
import { Platform, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidSheetHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { MaterialScreenContent } from "../../components/MaterialScreenContent";
import { NativeStackScreenOptions } from "../../native/StackHeader";

/**
 * The form sheet around "Park a thought" and "Note to self": a title with a
 * way out (Cancel on iOS, back on Android) and a scrolling body that keeps
 * taps while the keyboard is up. Android sizes the sheet to its content.
 */
export function ParkedSheetFrame(props: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const android = Platform.OS === "android";
  return (
    <View
      collapsable={false}
      className={android ? "bg-sheet" : "flex-1 bg-sheet"}
      style={android ? { maxHeight: windowHeight * 0.92 } : undefined}
    >
      {android ? (
        <>
          <NativeStackScreenOptions
            options={{ sheetCornerRadius: 28, sheetAllowedDetents: "fitToContents" }}
          />
          <AndroidSheetHeader title={props.title} onBack={props.onClose} hideBottomBorder />
        </>
      ) : (
        <View className="flex-row items-center px-3 pt-3">
          <Pressable
            accessibilityRole="button"
            onPress={props.onClose}
            className="min-h-11 w-20 justify-center px-2 active:opacity-70"
          >
            <Text className="text-base text-foreground">Cancel</Text>
          </Pressable>
          <Text
            accessibilityRole="header"
            className="flex-1 text-center text-base font-e6-semibold text-foreground"
            numberOfLines={1}
          >
            {props.title}
          </Text>
          <View className="w-20" />
        </View>
      )}
      <MaterialScreenContent fitToContents>
        <ScrollView
          className={android ? "shrink grow-0" : "flex-1"}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerClassName={android ? "gap-3 p-3" : "gap-3 px-4 pt-2"}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {props.children}
        </ScrollView>
      </MaterialScreenContent>
    </View>
  );
}
