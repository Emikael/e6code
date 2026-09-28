#pragma once

#include <react/renderer/components/E6MarkdownTextSpec/EventEmitters.h>
#include <react/renderer/components/E6MarkdownTextSpec/Props.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/core/ShadowNode.h>

#include <string>
#include <vector>

namespace facebook::react {

extern const char E6MarkdownTextComponentName[];

struct E6MarkdownTextParagraphStyleRange {
  size_t location;
  size_t length;
  Float firstLineHeadIndent;
  Float headIndent;
  Float paragraphSpacing;
};

struct E6MarkdownTextAttachmentRange {
  size_t location;
  size_t length;
  std::string imageUri;
  /// Recolor the loaded image with the run's foreground color, like `sf:` symbols.
  bool tintWithForeground;
  Float chipWidth = 0;
  Float chipHeight = 0;
};

inline Float E6MarkdownTextAttachmentSize(const E6MarkdownTextAttachmentRange &) {
  return 14;
}

inline Float E6MarkdownTextAttachmentBaselineOffset(
    const E6MarkdownTextAttachmentRange &) {
  return -2;
}

class E6MarkdownTextStateReal final {
 public:
  AttributedString attributedString;
  std::vector<E6MarkdownTextParagraphStyleRange> paragraphStyleRanges;
  std::vector<E6MarkdownTextAttachmentRange> attachmentRanges;
};

class E6MarkdownTextShadowNode final : public ConcreteViewShadowNode<
E6MarkdownTextComponentName,
E6MarkdownTextProps,
E6MarkdownTextEventEmitter,
E6MarkdownTextStateReal> {
public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  E6MarkdownTextShadowNode(
   const ShadowNode& sourceShadowNode,
   const ShadowNodeFragment& fragment
  );

  static ShadowNodeTraits BaseTraits() {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(ShadowNodeTraits::Trait::MeasurableYogaNode);
    return traits;
  }

  void layout(LayoutContext layoutContext) override;

  Size measureContent(
      const LayoutContext& layoutContext,
      const LayoutConstraints& layoutConstraints) const override;

private:
  mutable AttributedString _attributedString;
  mutable std::vector<E6MarkdownTextParagraphStyleRange> _paragraphStyleRanges;
  mutable std::vector<E6MarkdownTextAttachmentRange> _attachmentRanges;
};
} // namespace facebook::React
