import { type IconArtworkByWeight, type IconProps, IconSvg } from "../IconSvg.tsx";

// Test-only stand-in for a generated lazy module (`generated/lazy/IconFolder.tsx`): it exports
// the component `iconComponentName("folder")` names and renders the real IconSvg. The drawings
// are trivial first-party frames on the 256 grid, not Phosphor artwork.

const frame = (stroke: number) => (
  <>
    <rect x="32" y="56" width="192" height={stroke} />
    <rect x="32" y={200 - stroke} width="192" height={stroke} />
    <rect x="32" y="56" width={stroke} height="144" />
    <rect x={224 - stroke} y="56" width={stroke} height="144" />
  </>
);

const ARTWORK: IconArtworkByWeight = {
  regular: frame(16),
  bold: frame(24),
  fill: <rect x="32" y="56" width="192" height="144" />,
};

const TRAITS = { fillWhenActive: true } as const;

export function IconFolder(props: IconProps) {
  return <IconSvg {...props} name="folder" traits={TRAITS} artwork={ARTWORK} />;
}
