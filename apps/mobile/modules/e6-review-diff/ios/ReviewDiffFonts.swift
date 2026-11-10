import UIKit

/// Resolves the PostScript families the app embeds with expo-font (for example
/// `GeistMono-Regular` or `Geist-Regular`). Faces follow `<base>-<Weight>`, so a
/// weight picks its own face when the family ships one and the nearest heavier or
/// lighter face otherwise. A family that failed to load falls back to the system font.
enum ReviewDiffFontResolver {
  static func font(family: String?, size: CGFloat, weight: UIFont.Weight, monospaced: Bool) -> UIFont {
    if let family, !family.isEmpty {
      let base = family.range(of: "-", options: .backwards).map { String(family[..<$0.lowerBound]) } ?? family
      for suffix in faceSuffixes(for: weight) {
        if let font = UIFont(name: "\(base)-\(suffix)", size: size) {
          return font
        }
      }
      if let font = UIFont(name: family, size: size) {
        return font
      }
    }
    return monospaced
      ? UIFont.monospacedSystemFont(ofSize: size, weight: weight)
      : UIFont.systemFont(ofSize: size, weight: weight)
  }

  private static func faceSuffixes(for weight: UIFont.Weight) -> [String] {
    let value = weight.rawValue
    if value < UIFont.Weight.medium.rawValue {
      return ["Regular"]
    }
    if value < UIFont.Weight.semibold.rawValue {
      return ["Medium", "Regular"]
    }
    if value < UIFont.Weight.bold.rawValue {
      return ["SemiBold", "Bold"]
    }
    return ["Bold"]
  }
}
