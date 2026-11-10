import type { AssetResource, EnvironmentId } from "@e6tools/contracts";
import {
  htmlRenderFileName,
  htmlRenderFrameHeight,
  type HtmlRenderReference,
  htmlRenderTheme,
  htmlRenderThemeFragment,
} from "@e6tools/shared/htmlRender";
import {
  E6_CODE_DARK_THEME_COLORS,
  E6_CODE_LIGHT_THEME_COLORS,
} from "@e6tools/shared/themePalettes";
import { useMemo, useState } from "react";
import { Linking, Modal, Pressable, useColorScheme, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { AppText as Text } from "../../components/AppText";
import { useAssetUrlState } from "../../state/assets";

// Reports the page height to the app. The page's own bootstrap only reports to a parent frame.
const REPORT_HEIGHT_SCRIPT = `(function(){
var last=0;function report(){var r=document.documentElement,h=Math.ceil(Math.max(r.scrollHeight,r.getBoundingClientRect().height));
if(h&&h!==last){last=h;window.ReactNativeWebView.postMessage(JSON.stringify({e6HtmlRenderHeight:h}));}}
if(window.ResizeObserver){new ResizeObserver(report).observe(document.documentElement);}
window.addEventListener("load",report);report();})();true;`;

function readReportedHeight(event: WebViewMessageEvent): number | undefined {
  try {
    const data = JSON.parse(event.nativeEvent.data) as { e6HtmlRenderHeight?: unknown };
    const height = data.e6HtmlRenderHeight;
    return typeof height === "number" && Number.isFinite(height) && height > 0 ? height : undefined;
  } catch {
    return undefined;
  }
}

/** The page may only load its own signed URL; http(s) links leave for the system browser. */
function allowNavigation(assetUrl: string, requestedUrl: string): boolean {
  const base = (url: string) => url.split("#")[0];
  if (base(requestedUrl) === base(assetUrl) || requestedUrl === "about:blank") return true;
  if (/^https?:\/\//i.test(requestedUrl)) void Linking.openURL(requestedUrl);
  return false;
}

function ArtifactWebView(props: {
  readonly uri: string;
  readonly title: string;
  readonly scrollEnabled: boolean;
  readonly onHeight?: (height: number) => void;
}) {
  return (
    <WebView
      source={{ uri: props.uri }}
      // No native bridge beyond the height report; the server's CSP keeps the page sandboxed.
      injectedJavaScript={REPORT_HEIGHT_SCRIPT}
      onMessage={(event) => {
        const height = readReportedHeight(event);
        if (height !== undefined) props.onHeight?.(height);
      }}
      onShouldStartLoadWithRequest={(request) => allowNavigation(props.uri, request.url)}
      setSupportMultipleWindows={false}
      scrollEnabled={props.scrollEnabled}
      accessibilityLabel={props.title}
      style={{ flex: 1, backgroundColor: "transparent" }}
    />
  );
}

/** A page an agent published with `html_render`, inline in the reply with a full-screen view. */
export function HtmlRenderArtifact(props: {
  readonly environmentId: EnvironmentId;
  readonly htmlRender: HtmlRenderReference;
}) {
  const { attachmentId, title } = props.htmlRender;
  const scheme = useColorScheme() === "light" ? "light" : "dark";
  const resource = useMemo<AssetResource>(
    () => ({
      _tag: "attachment",
      attachmentId,
      fileName: htmlRenderFileName(title),
      mimeType: "text/html",
      disposition: "inline",
    }),
    [attachmentId, title],
  );
  const assetUrl = useAssetUrlState(props.environmentId, resource);
  // Keep the first URL so a re-minted one does not reload the page.
  const [firstUrl, setFirstUrl] = useState<string | null>(null);
  if (firstUrl === null && assetUrl._tag === "Success") setFirstUrl(assetUrl.url);
  const [contentHeight, setContentHeight] = useState<number>();
  const [fullScreen, setFullScreen] = useState(false);

  const uri =
    firstUrl === null
      ? null
      : `${firstUrl}${htmlRenderThemeFragment(
          htmlRenderTheme(
            scheme === "light" ? E6_CODE_LIGHT_THEME_COLORS : E6_CODE_DARK_THEME_COLORS,
            scheme,
          ),
        )}`;

  return (
    <View className="my-2 overflow-hidden rounded-xl border border-border bg-card">
      <View className="flex-row items-center justify-between gap-2 border-b border-border px-3 py-2">
        <Text className="flex-1 text-xs font-e6-bold text-foreground" numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${title} full screen`}
          disabled={uri === null}
          onPress={() => setFullScreen(true)}
          hitSlop={8}
        >
          <Text className="text-xs text-foreground-muted">Full screen</Text>
        </Pressable>
      </View>
      <View style={{ height: htmlRenderFrameHeight(props.htmlRender, contentHeight) }}>
        {uri !== null ? (
          <ArtifactWebView
            uri={uri}
            title={title}
            scrollEnabled={false}
            onHeight={setContentHeight}
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <Text className="text-xs text-foreground-muted">
              {assetUrl._tag === "Failure" ? `Unable to load ${title}` : "Loading page…"}
            </Text>
          </View>
        )}
      </View>
      {uri !== null ? (
        <Modal
          visible={fullScreen}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setFullScreen(false)}
        >
          <View className="flex-1 bg-card">
            <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
              <Text className="flex-1 text-sm font-e6-bold text-foreground" numberOfLines={1}>
                {title}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setFullScreen(false)}
                hitSlop={8}
              >
                <Text className="text-sm text-foreground">Done</Text>
              </Pressable>
            </View>
            <ArtifactWebView uri={uri} title={title} scrollEnabled />
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
