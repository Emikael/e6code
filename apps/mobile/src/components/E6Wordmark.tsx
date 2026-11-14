import {
  E6_GLYPH_ASPECT_RATIO,
  E6_GLYPH_PATHS,
  E6_GLYPH_VIEW_BOX,
} from "@e6tools/shared/brandMark";
import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

/**
 * The "E6" brand glyph, the same shape as the web E6Wordmark and the app icon.
 * Width derives from the glyph's aspect ratio.
 */
export function E6Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  return (
    <Svg
      accessibilityLabel="E6"
      height={props.height}
      width={props.height * E6_GLYPH_ASPECT_RATIO}
      viewBox={E6_GLYPH_VIEW_BOX}
    >
      {E6_GLYPH_PATHS.map((d) => (
        <ThemedPath
          key={d}
          d={d}
          color={props.color}
          colorClassName={props.colorClassName}
          fill="currentColor"
        />
      ))}
    </Svg>
  );
}
