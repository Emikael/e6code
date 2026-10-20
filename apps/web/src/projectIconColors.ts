import type { ProjectIconColor } from "@e6tools/contracts";

export const PROJECT_ICON_COLORS: ReadonlyArray<{
  readonly value: ProjectIconColor;
  readonly label: string;
  readonly className: string;
  readonly monogramClassName: string;
  readonly swatchClassName: string;
}> = [
  {
    value: "gray",
    label: "Gray",
    className: "text-gray-600 dark:text-gray-400",
    monogramClassName: "bg-gray-100 text-gray-900 dark:bg-gray-950 dark:text-gray-100",
    swatchClassName: "bg-gray-500",
  },
  {
    value: "red",
    label: "Red",
    className: "text-red-600 dark:text-red-400",
    monogramClassName: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
    swatchClassName: "bg-red-500",
  },
  {
    value: "orange",
    label: "Orange",
    className: "text-orange-600 dark:text-orange-400",
    monogramClassName: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-100",
    swatchClassName: "bg-orange-500",
  },
  {
    value: "amber",
    label: "Amber",
    className: "text-amber-600 dark:text-amber-400",
    monogramClassName: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
    swatchClassName: "bg-amber-500",
  },
  {
    value: "yellow",
    label: "Yellow",
    className: "text-yellow-600 dark:text-yellow-400",
    monogramClassName: "bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-100",
    swatchClassName: "bg-yellow-500",
  },
  {
    value: "lime",
    label: "Lime",
    className: "text-lime-600 dark:text-lime-400",
    monogramClassName: "bg-lime-100 text-lime-900 dark:bg-lime-950 dark:text-lime-100",
    swatchClassName: "bg-lime-500",
  },
  {
    value: "green",
    label: "Green",
    className: "text-green-600 dark:text-green-400",
    monogramClassName: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100",
    swatchClassName: "bg-green-500",
  },
  {
    value: "emerald",
    label: "Emerald",
    className: "text-emerald-600 dark:text-emerald-400",
    monogramClassName: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    swatchClassName: "bg-emerald-500",
  },
  {
    value: "teal",
    label: "Teal",
    className: "text-teal-600 dark:text-teal-400",
    monogramClassName: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-100",
    swatchClassName: "bg-teal-500",
  },
  {
    value: "cyan",
    label: "Cyan",
    className: "text-cyan-600 dark:text-cyan-400",
    monogramClassName: "bg-cyan-100 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-100",
    swatchClassName: "bg-cyan-500",
  },
  {
    value: "sky",
    label: "Sky",
    className: "text-sky-600 dark:text-sky-400",
    monogramClassName: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100",
    swatchClassName: "bg-sky-500",
  },
  {
    value: "blue",
    label: "Blue",
    className: "text-blue-600 dark:text-blue-400",
    monogramClassName: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
    swatchClassName: "bg-blue-500",
  },
  {
    value: "indigo",
    label: "Indigo",
    className: "text-indigo-600 dark:text-indigo-400",
    monogramClassName: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100",
    swatchClassName: "bg-indigo-500",
  },
  {
    value: "violet",
    label: "Violet",
    className: "text-violet-600 dark:text-violet-400",
    monogramClassName: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100",
    swatchClassName: "bg-violet-500",
  },
  {
    value: "purple",
    label: "Purple",
    className: "text-purple-600 dark:text-purple-400",
    monogramClassName: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-100",
    swatchClassName: "bg-purple-500",
  },
  {
    value: "fuchsia",
    label: "Fuchsia",
    className: "text-fuchsia-600 dark:text-fuchsia-400",
    monogramClassName: "bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-950 dark:text-fuchsia-100",
    swatchClassName: "bg-fuchsia-500",
  },
  {
    value: "pink",
    label: "Pink",
    className: "text-pink-600 dark:text-pink-400",
    monogramClassName: "bg-pink-100 text-pink-900 dark:bg-pink-950 dark:text-pink-100",
    swatchClassName: "bg-pink-500",
  },
  {
    value: "rose",
    label: "Rose",
    className: "text-rose-600 dark:text-rose-400",
    monogramClassName: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100",
    swatchClassName: "bg-rose-500",
  },
];

const PROJECT_ICON_COLOR_CLASSES = Object.fromEntries(
  PROJECT_ICON_COLORS.map(({ value, className }) => [value, className]),
) as Record<ProjectIconColor, string>;

const PROJECT_MONOGRAM_CLASSES = Object.fromEntries(
  PROJECT_ICON_COLORS.map(({ value, monogramClassName }) => [value, monogramClassName]),
) as Record<ProjectIconColor, string>;

export function projectIconColorClassName(color: ProjectIconColor): string {
  return PROJECT_ICON_COLOR_CLASSES[color];
}

/** Opaque tile ink. The faint currentColor wash misses 4.5:1 on light surfaces. */
export function projectMonogramClassName(color: ProjectIconColor): string {
  return PROJECT_MONOGRAM_CLASSES[color];
}
