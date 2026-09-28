import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

/**
 * The "E6" brand mark, matching the desktop sidebar's E6Wordmark SVG
 * (apps/web Sidebar.tsx). Width derives from the viewBox aspect ratio.
 */
export function E6Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  const aspectRatio = 94.3941 / 56.96;
  return (
    <Svg
      accessibilityLabel="E6"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="16 36 95 59"
    >
      <ThemedPath
        d="M16 37H59V48H29V60H56V71H29V83H59V94H16ZM88 36C99 36 106 40 110 49L99 54C97 49 93 47 88 47C80 47 75 53 75 62C79 58 84 56 90 56C102 56 111 64 111 75C111 87 101 95 88 95C72 95 62 84 62 67C62 48 72 36 88 36ZM88 67C80 67 75 71 75 76C75 81 80 84 88 84C95 84 99 81 99 76C99 71 95 67 88 67Z"
        fillRule="evenodd"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
