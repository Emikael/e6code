import { BRAND_GLYPH } from "@e6tools/design-tokens/brand";
import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

/**
 * The "E6" brand mark, the same glyph as the web E6Wordmark (one source in
 * @e6tools/design-tokens/brand). Width derives from the viewBox aspect ratio.
 */
export function E6Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  const aspectRatio = BRAND_GLYPH.width / BRAND_GLYPH.height;
  return (
    <Svg
      accessibilityLabel="E6"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox={BRAND_GLYPH.viewBox}
    >
      <ThemedPath
        d={BRAND_GLYPH.path}
        fillRule="evenodd"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
