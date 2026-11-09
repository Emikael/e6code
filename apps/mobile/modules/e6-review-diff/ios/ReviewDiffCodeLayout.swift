import UIKit

/// Shiki token style bits (1 italic, 2 bold, 4 underline) over a UTF-16 range of a row.
struct ReviewDiffCodeStyleRun: Equatable {
  let location: Int
  let length: Int
  let fontStyle: Int
}

/// Code faces for token styles, resolved once per view style.
struct ReviewDiffCodeFaces {
  let regular: UIFont
  let bold: UIFont
  let italic: UIFont
  let boldItalic: UIFont

  func font(forTokenStyle fontStyle: Int) -> UIFont {
    switch (fontStyle & 2 != 0, fontStyle & 1 != 0) {
    case (true, true): return boldItalic
    case (true, false): return bold
    case (false, true): return italic
    case (false, false): return regular
    }
  }
}

/// ASCII uses fixed-pitch columns. TextKit handles shaping, tabs, and Unicode highlights.
/// TextKit rows are measured with their token faces applied, so bold or italic fallback
/// glyphs (CJK, emoji) wrap at their real advances; `styleRuns` is part of their identity.
final class ReviewDiffCodeLayout: NSObject {
  // Measurement reuses one engine; only recently drawn rows retain a full TextKit layout.
  private static var measurer: ReviewDiffTextLayout {
    let key = "E6ReviewDiff.textMeasurer"
    if let layout = Thread.current.threadDictionary[key] as? ReviewDiffTextLayout { return layout }
    let layout = ReviewDiffTextLayout()
    Thread.current.threadDictionary[key] = layout
    return layout
  }
  private static let drawnLayouts: NSCache<ReviewDiffCodeLayout, ReviewDiffTextLayout> = {
    let cache = NSCache<ReviewDiffCodeLayout, ReviewDiffTextLayout>()
    cache.countLimit = 128
    return cache
  }()
  let text: String
  let starts: [Int]
  let lineHeight: CGFloat
  let firstLineHeight: CGFloat
  let extraHeight: CGFloat
  private let font: UIFont
  private let width: CGFloat
  private let characterWidth: CGFloat
  let usesNativeLayout: Bool
  /// Empty for fixed-pitch rows, whose columns do not depend on token styles.
  let styleRuns: [ReviewDiffCodeStyleRun]
  private let faces: ReviewDiffCodeFaces?

  static func isFixedPitch(_ text: String) -> Bool {
    text.utf8.allSatisfy { $0 >= 32 && $0 <= 126 }
  }

  init(
    text: String,
    font: UIFont,
    width: CGFloat,
    characterWidth: CGFloat,
    styleRuns: [ReviewDiffCodeStyleRun] = [],
    faces: ReviewDiffCodeFaces? = nil
  ) {
    self.text = text
    self.font = font
    self.width = width
    self.characterWidth = characterWidth
    lineHeight = ceil(font.lineHeight)
    if Self.isFixedPitch(text) {
      self.styleRuns = []
      self.faces = nil
      let columns = max(1, Int(width / characterWidth))
      starts = Array(stride(from: 0, to: max(1, text.utf8.count), by: columns))
      firstLineHeight = font.lineHeight
      extraHeight = CGFloat(starts.count - 1) * lineHeight
      usesNativeLayout = false
    } else {
      self.styleRuns = styleRuns
      self.faces = faces
      let layout = Self.measurer
      layout.configure(
        text: text, font: font, width: width, characterWidth: characterWidth,
        styleRuns: styleRuns, faces: faces
      )
      let manager = layout.manager
      let container = layout.container
      usesNativeLayout = true
      starts = [0]
      firstLineHeight = manager.numberOfGlyphs > 0
        ? manager.lineFragmentRect(forGlyphAt: 0, effectiveRange: nil).height : font.lineHeight
      extraHeight = max(0, manager.usedRect(for: container).height - firstLineHeight)
    }
  }

  private func nativeLayout() -> ReviewDiffTextLayout {
    if let cached = Self.drawnLayouts.object(forKey: self) { return cached }
    let layout = ReviewDiffTextLayout()
    layout.configure(
      text: text, font: font, width: width, characterWidth: characterWidth,
      styleRuns: styleRuns, faces: faces
    )
    Self.drawnLayouts.setObject(layout, forKey: self)
    return layout
  }

  /// Only colors change here; token faces were applied before measurement.
  func decorate(text: NSAttributedString, highlights: [NSRange], color: UIColor, version: Int) {
    guard usesNativeLayout else { return }
    let layout = nativeLayout()
    guard layout.decorationVersion != version else { return }
    let storage = layout.storage
    let fullRange = NSRange(location: 0, length: storage.length)
    storage.beginEditing()
    storage.removeAttribute(.foregroundColor, range: fullRange)
    storage.removeAttribute(.backgroundColor, range: fullRange)
    text.enumerateAttribute(.foregroundColor, in: NSRange(location: 0, length: text.length)) { value, range, _ in
      let intersection = NSIntersectionRange(range, fullRange)
      if let value, intersection.length > 0 {
        storage.addAttribute(.foregroundColor, value: value, range: intersection)
      }
    }
    for range in highlights {
      let intersection = NSIntersectionRange(range, fullRange)
      if intersection.length > 0 {
        storage.addAttribute(.backgroundColor, value: color, range: intersection)
      }
    }
    storage.endEditing()
    layout.decorationVersion = version
  }

  func draw(at origin: CGPoint, clip: CGRect) {
    guard usesNativeLayout else { return }
    let layout = nativeLayout()
    let manager = layout.manager
    let container = layout.container
    let visible = clip.offsetBy(dx: -origin.x, dy: -origin.y)
    let range = manager.glyphRange(forBoundingRect: visible, in: container)
    manager.drawBackground(forGlyphRange: range, at: origin)
    manager.drawGlyphs(forGlyphRange: range, at: origin)
  }
}

private final class ReviewDiffTextLayout {
  let storage = NSTextStorage()
  let manager = NSLayoutManager()
  let container = NSTextContainer(size: .zero)
  var decorationVersion = -1

  init() {
    container.lineFragmentPadding = 0
    container.lineBreakMode = .byCharWrapping
    manager.addTextContainer(container)
    storage.addLayoutManager(manager)
  }

  func configure(
    text: String,
    font: UIFont,
    width: CGFloat,
    characterWidth: CGFloat,
    styleRuns: [ReviewDiffCodeStyleRun] = [],
    faces: ReviewDiffCodeFaces? = nil
  ) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = .byCharWrapping
    paragraph.tabStops = []
    paragraph.defaultTabInterval = characterWidth * 4
    container.size = CGSize(width: max(1, width), height: .greatestFiniteMagnitude)
    let attributed = NSMutableAttributedString(string: text, attributes: [
      .font: font, .ligature: 0, .paragraphStyle: paragraph,
    ])
    let fullRange = NSRange(location: 0, length: attributed.length)
    for run in styleRuns {
      let range = NSIntersectionRange(NSRange(location: run.location, length: run.length), fullRange)
      guard range.length > 0 else { continue }
      if let faces, run.fontStyle & 3 != 0 {
        attributed.addAttribute(.font, value: faces.font(forTokenStyle: run.fontStyle), range: range)
      }
      if run.fontStyle & 4 != 0 {
        attributed.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: range)
      }
    }
    storage.setAttributedString(attributed)
    manager.ensureLayout(for: container)
  }
}
