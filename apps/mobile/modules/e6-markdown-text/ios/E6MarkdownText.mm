#import "E6MarkdownText.h"
#import "E6MarkdownTextShadowNode.h"
#import "E6MarkdownTextComponentDescriptor.h"
#import "E6MarkdownTextRun.h"
#import "E6ContextChip.h"
#import <React/RCTConversions.h>
#import <objc/runtime.h>

#import <react/renderer/textlayoutmanager/RCTAttributedTextUtils.h>
#import <react/renderer/components/E6MarkdownTextSpec/EventEmitters.h>
#import <react/renderer/components/E6MarkdownTextSpec/Props.h>
#import <react/renderer/components/E6MarkdownTextSpec/RCTComponentViewHelpers.h>
#import "RCTFabricComponentsPlugins.h"

using namespace facebook::react;

@interface E6ContextChipAccessibilityElement : UIAccessibilityElement
@property(nonatomic, weak) E6MarkdownTextRun *run;
@end

@implementation E6ContextChipAccessibilityElement
- (BOOL)accessibilityActivate
{
  if (self.run == nil) return NO;
  [self.run onPress];
  return YES;
}
@end

/** Preserve canonical references and their payload when copying a native text selection. */
@interface E6ContextCopyTextView : UITextView
@property(nonatomic, copy) NSDictionary *contextClipboardConfig;
@end

@implementation E6ContextCopyTextView
// Read-only text still supports selecting the entire document after selecting a word.
- (BOOL)canPerformAction:(SEL)action withSender:(id)sender
{
  if (action == @selector(selectAll:)) {
    return self.selectable && self.text.length > 0 && self.selectedRange.length < self.text.length;
  }
  return [super canPerformAction:action withSender:sender];
}

- (void)copy:(id)sender
{
  NSRange selected = self.selectedRange;
  NSArray *ranges = self.contextClipboardConfig[@"ranges"];
  if (selected.location == NSNotFound || selected.length == 0 || NSMaxRange(selected) > self.text.length || ranges.count == 0) {
    [super copy:sender];
    return;
  }
  NSMutableString *text = [[self.text substringWithRange:selected] mutableCopy];
  BOOL hasContext = NO;
  for (NSDictionary *range in [ranges reverseObjectEnumerator]) {
    NSUInteger start = [range[@"start"] unsignedIntegerValue];
    NSUInteger end = [range[@"end"] unsignedIntegerValue];
    if (end <= start || end > self.text.length) continue;
    NSRange overlap = NSIntersectionRange(selected, NSMakeRange(start, end - start));
    if (overlap.length == 0 || ![range[@"text"] isKindOfClass:NSString.class]) continue;
    [text replaceCharactersInRange:NSMakeRange(overlap.location - selected.location, overlap.length) withString:range[@"text"]];
    hasContext = YES;
  }
  if (!hasContext) { [super copy:sender]; return; }
  [text replaceOccurrencesOfString:@"\uFFFC\u00A0" withString:@"" options:0 range:NSMakeRange(0, text.length)];
  NSString *fragment = self.contextClipboardConfig[@"fragment"];
  NSMutableDictionary *payload = [[NSJSONSerialization JSONObjectWithData:[fragment dataUsingEncoding:NSUTF8StringEncoding] options:NSJSONReadingMutableContainers error:nil] mutableCopy];
  NSArray *records = payload[@"records"];
  NSMutableArray *copied = [NSMutableArray array];
  NSMutableSet *screenshots = [NSMutableSet set];
  for (NSDictionary *record in records) {
    if ([text containsString:[NSString stringWithFormat:@"/%@)", record[@"contextId"]]]) {
      [copied addObject:record];
      if ([record[@"screenshotContextId"] isKindOfClass:NSString.class]) [screenshots addObject:record[@"screenshotContextId"]];
    }
  }
  for (NSDictionary *record in records) {
    if ([screenshots containsObject:record[@"contextId"]] && ![copied containsObject:record]) [copied addObject:record];
  }
  payload[@"records"] = copied;
  NSData *encoded = payload ? [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil] : nil;
  NSMutableDictionary *item = [@{@"public.utf8-plain-text": text} mutableCopy];
  if (encoded && copied.count > 0) {
    NSString *raw = [[NSString alloc] initWithData:encoded encoding:NSUTF8StringEncoding];
    NSString *attribute = [raw stringByAddingPercentEncodingWithAllowedCharacters:NSCharacterSet.alphanumericCharacterSet];
    NSString *escaped = [[[text stringByReplacingOccurrencesOfString:@"&" withString:@"&amp;"] stringByReplacingOccurrencesOfString:@"<" withString:@"&lt;"] stringByReplacingOccurrencesOfString:@">" withString:@"&gt;"];
    item[@"app.e6.context-fragment"] = encoded;
    item[@"public.html"] = [[NSString stringWithFormat:@"<pre data-e6-context-fragment=\"%@\">%@</pre>", attribute, escaped] dataUsingEncoding:NSUTF8StringEncoding];
  }
  UIPasteboard.generalPasteboard.items = @[item];
}
@end

static void E6MarkdownTextApplyParagraphStyles(
    NSMutableAttributedString *attributedString,
    const std::vector<E6MarkdownTextParagraphStyleRange> &styleRanges)
{
  for (const auto &styleRange : styleRanges) {
    if (styleRange.length == 0 || styleRange.location >= attributedString.length) {
      continue;
    }

    const NSRange markerRange = NSMakeRange(
        styleRange.location,
        MIN(styleRange.length, attributedString.length - styleRange.location));
    const NSRange paragraphRange = [attributedString.string paragraphRangeForRange:markerRange];
    const NSParagraphStyle *existingStyle =
        [attributedString attribute:NSParagraphStyleAttributeName
                            atIndex:paragraphRange.location
                     effectiveRange:nil];
    NSMutableParagraphStyle *paragraphStyle =
        existingStyle ? [existingStyle mutableCopy] : [NSMutableParagraphStyle new];
    paragraphStyle.firstLineHeadIndent = styleRange.firstLineHeadIndent;
    paragraphStyle.headIndent = styleRange.headIndent;
    paragraphStyle.paragraphSpacing = styleRange.paragraphSpacing;
    paragraphStyle.tabStops = @[
      [[NSTextTab alloc] initWithTextAlignment:NSTextAlignmentLeft
                                      location:styleRange.headIndent
                                       options:@{}]
    ];
    paragraphStyle.defaultTabInterval = styleRange.headIndent;
    [attributedString addAttribute:NSParagraphStyleAttributeName
                             value:paragraphStyle
                             range:paragraphRange];
  }
}

static void E6MarkdownTextApplyAttachments(
    NSMutableAttributedString *attributedString,
    const std::vector<E6MarkdownTextAttachmentRange> &attachmentRanges,
    NSDictionary<NSString *, UIImage *> *images)
{
  for (const auto &attachmentRange : attachmentRanges) {
    if (attachmentRange.length == 0 || attachmentRange.location >= attributedString.length) {
      continue;
    }

    NSString *imageUri = [NSString stringWithUTF8String:attachmentRange.imageUri.c_str()];
    NSTextAttachment *attachment = [[NSTextAttachment alloc] init];
    UIImage *image = images[imageUri];
    const BOOL isSymbol = [imageUri hasPrefix:@"sf:"];
    if (isSymbol) {
      image = [UIImage systemImageNamed:[imageUri substringFromIndex:3]];
    }
    NSDictionary *runAttributes =
        [attributedString attributesAtIndex:attachmentRange.location effectiveRange:nil];
    UIColor *foregroundColor = runAttributes[NSForegroundColorAttributeName];
    if (image != nil && (isSymbol || attachmentRange.tintWithForeground)) {
      image = [image imageWithTintColor:foregroundColor ?: UIColor.labelColor
                          renderingMode:UIImageRenderingModeAlwaysOriginal];
    }
    attachment.image = image ?: [[UIImage alloc] init];
    const CGFloat attachmentSize = E6MarkdownTextAttachmentSize(attachmentRange);
    attachment.bounds = CGRectMake(
        0,
        E6MarkdownTextAttachmentBaselineOffset(attachmentRange),
        attachmentSize,
        attachmentSize);
    NSDictionary *chip = E6ContextChipPayload(imageUri);
    if (chip != nil) {
      CGSize size = CGSizeMake(attachmentRange.chipWidth, attachmentRange.chipHeight);
      attachment.bounds = E6ContextChipBounds(runAttributes[NSFontAttributeName], size);
      NSString *iconUri = [chip[@"iconUri"] isKindOfClass:NSString.class] ? chip[@"iconUri"] : nil;
      attachment.image = E6ContextChipImage(chip, size, iconUri ? images[iconUri] : nil);
    }
    const NSRange range = NSMakeRange(
        attachmentRange.location,
        MIN(attachmentRange.length, attributedString.length - attachmentRange.location));
    [attributedString replaceCharactersInRange:range
                          withAttributedString:E6MarkdownTextAttachmentString(attachment, runAttributes)];
  }
}

@protocol E6MarkdownOutsideTapTarget <NSObject>
- (void)clearSelectionForOutsideTapWithHitView:(UIView *)hitView;
@end

@interface E6MarkdownOutsideTapCoordinator : NSObject <UIGestureRecognizerDelegate>

- (instancetype)initWithWindow:(UIWindow *)window;
- (void)addTarget:(id<E6MarkdownOutsideTapTarget>)target;
- (void)removeTarget:(id<E6MarkdownOutsideTapTarget>)target;

@end

static const void *E6MarkdownOutsideTapCoordinatorKey =
    &E6MarkdownOutsideTapCoordinatorKey;

@implementation E6MarkdownOutsideTapCoordinator {
  __weak UIWindow *_window;
  UITapGestureRecognizer *_recognizer;
  NSHashTable<id<E6MarkdownOutsideTapTarget>> *_targets;
}

- (instancetype)initWithWindow:(UIWindow *)window
{
  if (self = [super init]) {
    _window = window;
    _targets = [NSHashTable weakObjectsHashTable];
    _recognizer = [[UITapGestureRecognizer alloc] initWithTarget:self
                                                          action:@selector(handleTap:)];
    _recognizer.cancelsTouchesInView = NO;
    _recognizer.delegate = self;
    [window addGestureRecognizer:_recognizer];
  }
  return self;
}

- (void)addTarget:(id<E6MarkdownOutsideTapTarget>)target
{
  [_targets addObject:target];
}

- (void)removeTarget:(id<E6MarkdownOutsideTapTarget>)target
{
  [_targets removeObject:target];
  if (_targets.count > 0) {
    return;
  }

  UIWindow *window = _window;
  [window removeGestureRecognizer:_recognizer];
  if (objc_getAssociatedObject(window, E6MarkdownOutsideTapCoordinatorKey) == self) {
    objc_setAssociatedObject(
        window,
        E6MarkdownOutsideTapCoordinatorKey,
        nil,
        OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
}

- (void)handleTap:(UITapGestureRecognizer *)sender
{
  UIWindow *window = _window;
  if (window == nil) {
    return;
  }

  UIView *hitView = [window hitTest:[sender locationInView:window] withEvent:nil];
  if (hitView == nil) {
    return;
  }
  for (id<E6MarkdownOutsideTapTarget> target in _targets.allObjects) {
    [target clearSelectionForOutsideTapWithHitView:hitView];
  }
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer
    shouldRecognizeSimultaneouslyWithGestureRecognizer:(UIGestureRecognizer *)otherGestureRecognizer
{
  return YES;
}

@end

static E6MarkdownOutsideTapCoordinator *
E6MarkdownOutsideTapCoordinatorForWindow(UIWindow *window)
{
  E6MarkdownOutsideTapCoordinator *coordinator =
      objc_getAssociatedObject(window, E6MarkdownOutsideTapCoordinatorKey);
  if (coordinator == nil) {
    coordinator = [[E6MarkdownOutsideTapCoordinator alloc] initWithWindow:window];
    objc_setAssociatedObject(
        window,
        E6MarkdownOutsideTapCoordinatorKey,
        coordinator,
        OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  return coordinator;
}

@interface E6MarkdownText () <RCTE6MarkdownTextViewProtocol, UIGestureRecognizerDelegate, UITextViewDelegate>

@end

@interface E6MarkdownText () <E6MarkdownOutsideTapTarget>
@end

@implementation E6MarkdownText {
  UIView * _view;
  E6ContextCopyTextView * _textView;
  E6MarkdownTextShadowNode::ConcreteState::Shared _state;
  __weak UIWindow * _outsideTapWindow;
  BOOL _suppressSelectionChange;
  NSMutableDictionary<NSString *, UIImage *> * _attachmentImages;
  NSMutableSet<NSString *> * _pendingAttachmentUris;
  UILongPressGestureRecognizer *_longPressGestureRecognizer;
  UITapGestureRecognizer *_pressGestureRecognizer;
  NSArray *_contextAccessibilityElements;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<E6MarkdownTextComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const E6MarkdownTextProps>();
    _props = defaultProps;

    _view = [[UIView alloc] init];
    self.contentView = _view;
    self.clipsToBounds = true;

    _textView = [[E6ContextCopyTextView alloc] init];
    _attachmentImages = [[NSMutableDictionary alloc] init];
    _pendingAttachmentUris = [[NSMutableSet alloc] init];
    _textView.scrollEnabled = false;
    _textView.editable = false;
    _textView.textContainerInset = UIEdgeInsetsZero;
    _textView.textContainer.lineFragmentPadding = 0;
    _textView.delegate = self;
    // Chat text supports selection and contextual actions, but not drag-and-drop.
    _textView.textDragInteraction.enabled = NO;
    _textView.linkTextAttributes = @{};
    // Must match RCTTextLayoutManager, which measures with usesFontLeading = NO.
    _textView.layoutManager.usesFontLeading = NO;
    [self addSubview:_textView];

    _longPressGestureRecognizer = [[UILongPressGestureRecognizer alloc] initWithTarget:self
                                                                                 action:@selector(handleLongPressIfNecessary:)];
    _longPressGestureRecognizer.delegate = self;

    _pressGestureRecognizer = [[UITapGestureRecognizer alloc] initWithTarget:self
                                                                       action:@selector(handlePressIfNecessary:)];
    _pressGestureRecognizer.delegate = self;
    [_pressGestureRecognizer requireGestureRecognizerToFail:_longPressGestureRecognizer];

    [_textView addGestureRecognizer:_pressGestureRecognizer];
    [_textView addGestureRecognizer:_longPressGestureRecognizer];
  }

  return self;
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  if (_outsideTapWindow == self.window) {
    return;
  }
  if (_outsideTapWindow != nil) {
    E6MarkdownOutsideTapCoordinator *coordinator =
        objc_getAssociatedObject(_outsideTapWindow, E6MarkdownOutsideTapCoordinatorKey);
    [coordinator removeTarget:self];
  }
  _outsideTapWindow = self.window;
  if (_outsideTapWindow != nil) {
    [E6MarkdownOutsideTapCoordinatorForWindow(_outsideTapWindow) addTarget:self];
  }
}

- (void)dealloc
{
  E6MarkdownOutsideTapCoordinator *coordinator =
      objc_getAssociatedObject(_outsideTapWindow, E6MarkdownOutsideTapCoordinatorKey);
  [coordinator removeTarget:self];
}

- (NSArray *)accessibilityElements
{
  return _contextAccessibilityElements ?: [super accessibilityElements];
}

// See RCTParagraphComponentView
- (void)prepareForRecycle
{
  [super prepareForRecycle];
  E6MarkdownOutsideTapCoordinator *coordinator =
      objc_getAssociatedObject(_outsideTapWindow, E6MarkdownOutsideTapCoordinatorKey);
  [coordinator removeTarget:self];
  _outsideTapWindow = nil;
  _state.reset();

  // Reset the frame to zero so that when it properly lays out on the next use
  _textView.frame = CGRectZero;
  _textView.attributedText = nil;
  _contextAccessibilityElements = nil;
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  // _textView's frame is assigned inside drawRect, which only fires when
  // state changes. Trigger a redraw whenever the host frame moves out from
  // under it (rotation, parent relayout) so the text view resizes and
  // onTextLayout re-fires with the new line wrapping.
  if (!CGRectEqualToRect(_textView.frame, _view.frame)) {
    [self setNeedsDisplay];
  }
}

- (void)drawRect:(CGRect)rect
{
  if (!_state) {
    return;
  }

  const auto &props = *std::static_pointer_cast<E6MarkdownTextProps const>(_props);

  const auto attrString = _state->getData().attributedString;
  NSMutableAttributedString *convertedAttrString =
      [RCTNSAttributedStringFromAttributedString(attrString) mutableCopy];
  E6MarkdownTextApplyParagraphStyles(
      convertedAttrString,
      _state->getData().paragraphStyleRanges);
  E6MarkdownTextApplyAttachments(
      convertedAttrString,
      _state->getData().attachmentRanges,
      _attachmentImages);
  // Matches the shadow node so drawn lines sit where measurement put them.
  RCTApplyBaselineOffset(convertedAttrString);
  NSUInteger runLocation = 0;
  for (UIView *child in self.subviews) {
    if (![child isKindOfClass:[E6MarkdownTextRun class]]) {
      continue;
    }

    E6MarkdownTextRun *textChild = (E6MarkdownTextRun *)child;
    const NSRange runRange = NSMakeRange(runLocation, textChild.text.length);
    runLocation = NSMaxRange(runRange);
    if (![textChild hasContextMenu] || runRange.length == 0 ||
        NSMaxRange(runRange) > convertedAttrString.length) {
      continue;
    }

    NSURL *link = [NSURL URLWithString:
        [NSString stringWithFormat:@"e6-markdown-run://%ld", (long)textChild.tag]];
    if (link != nil) {
      // A glyph must not be both a link and an attachment. UIKit caches them as
      // different text-item classes and can send `attachment` to a cached link
      // on a later tap. Attachment actions already use primaryActionForTextItem.
      [convertedAttrString enumerateAttribute:NSAttachmentAttributeName
                                     inRange:runRange
                                     options:0
                                  usingBlock:^(id attachment, NSRange range, BOOL *stop) {
        if (attachment == nil) {
          [convertedAttrString addAttribute:NSLinkAttributeName value:link range:range];
        }
      }];
    }
  }
  [self loadAttachmentImages:_state->getData().attachmentRanges];

  // Setting attributedText clears any active text selection, and re-assigning
  // the frame triggers a layout flush that has the same effect. Bail out
  // entirely when nothing actually changed so a JS-side state update made in
  // response to onSelectionChange doesn't deselect what the user is selecting.
  const BOOL textChanged = ![_textView.attributedText isEqualToAttributedString:convertedAttrString];
  const BOOL frameChanged = !CGRectEqualToRect(_textView.frame, _view.frame);
  if (!textChanged && !frameChanged) {
    return;
  }
  if (textChanged) {
    // Reassigning attributedText clears any active selection. Save it and
    // restore after, while suppressing the synthetic textViewDidChangeSelection
    // events the clear-then-restore would otherwise produce — those would
    // round-trip to JS and re-trigger this same path, causing a loop.
    const NSRange savedRange = _textView.selectedRange;
    _suppressSelectionChange = YES;
    _textView.attributedText = convertedAttrString;
    NSMutableString *accessibleText = [convertedAttrString.string mutableCopy];
    for (auto it = _state->getData().attachmentRanges.rbegin();
         it != _state->getData().attachmentRanges.rend(); ++it) {
      NSDictionary *chip = E6ContextChipPayload([NSString stringWithUTF8String:it->imageUri.c_str()]);
      if (chip != nil && it->location < accessibleText.length) {
        [accessibleText replaceCharactersInRange:NSMakeRange(it->location, 1) withString:chip[@"label"]];
      }
    }
    _textView.accessibilityLabel = accessibleText;
    if (savedRange.length > 0 && NSMaxRange(savedRange) <= _textView.attributedText.length) {
      _textView.selectedRange = savedRange;
    }
    _suppressSelectionChange = NO;
  }
  if (frameChanged) {
    _textView.frame = _view.frame;
  }

  // Text attachments have no native link element. Expose their existing runs
  // at the measured glyph bounds, without inserting views into text layout.
  NSMutableArray *accessibleElements = [NSMutableArray arrayWithObject:_textView];
  for (UIView *child in self.subviews) {
    if (![child isKindOfClass:E6MarkdownTextRun.class]) continue;
    E6MarkdownTextRun *run = (E6MarkdownTextRun *)child;
    run.contextChipInteractive = NO;
  }
  for (const auto &attachmentRange : _state->getData().attachmentRanges) {
    NSDictionary *chip = E6ContextChipPayload(
        [NSString stringWithUTF8String:attachmentRange.imageUri.c_str()]);
    if (![chip[@"interactive"] boolValue]) continue;
    NSRange range = NSMakeRange(attachmentRange.location, 1);
    E6MarkdownTextRun *run = [self childForCharacterRange:range];
    if (!run || NSMaxRange(range) > convertedAttrString.length) continue;
    NSRange glyphRange = [_textView.layoutManager glyphRangeForCharacterRange:range actualCharacterRange:nil];
    CGRect bounds = [_textView.layoutManager boundingRectForGlyphRange:glyphRange
                                                     inTextContainer:_textView.textContainer];
    bounds = CGRectOffset(bounds, _textView.textContainerInset.left, _textView.textContainerInset.top);
    run.contextChipInteractive = YES;
    E6ContextChipAccessibilityElement *element =
        [[E6ContextChipAccessibilityElement alloc] initWithAccessibilityContainer:self];
    element.run = run;
    element.accessibilityLabel = chip[@"label"];
    element.accessibilityTraits = UIAccessibilityTraitButton;
    element.accessibilityFrameInContainerSpace = [_textView convertRect:bounds toView:self];
    [accessibleElements addObject:element];
  }
  _contextAccessibilityElements = accessibleElements;

  __block std::vector<std::string> lines;
  const int maxLines = props.numberOfLines;
  [_textView.layoutManager enumerateLineFragmentsForGlyphRange:NSMakeRange(0, convertedAttrString.string.length) usingBlock:^(CGRect rect,
                                                                                              CGRect usedRect,
                                                                                              NSTextContainer * _Nonnull textContainer,
                                                                                              NSRange glyphRange,
                                                                                              BOOL * _Nonnull stop) {
    const auto charRange = [self->_textView.layoutManager characterRangeForGlyphRange:glyphRange actualGlyphRange:nil];
    const auto line = [self->_textView.text substringWithRange:charRange];
    lines.push_back(line.UTF8String);
    // enumerateLineFragments overshoots maximumNumberOfLines by one on iOS
    // 18, so cap explicitly.
    if (maxLines > 0 && lines.size() >= (size_t)maxLines) {
      *stop = YES;
    }
  }];

  if (_eventEmitter != nullptr) {
    std::dynamic_pointer_cast<const facebook::react::E6MarkdownTextEventEmitter>(_eventEmitter)
    ->onTextLayout(facebook::react::E6MarkdownTextEventEmitter::OnTextLayout{static_cast<int>(self.tag), lines});
  };
}

- (void)loadAttachmentImages:(const std::vector<E6MarkdownTextAttachmentRange> &)attachmentRanges
{
  for (const auto &attachmentRange : attachmentRanges) {
    NSString *imageUri = [NSString stringWithUTF8String:attachmentRange.imageUri.c_str()];
    if ([imageUri hasPrefix:@"sf:"]) {
      continue;
    }
    NSDictionary *chip = E6ContextChipPayload(imageUri);
    if (chip != nil) {
      imageUri = [chip[@"iconUri"] isKindOfClass:NSString.class] ? chip[@"iconUri"] : nil;
      if (imageUri.length == 0) continue;
    }
    if (_attachmentImages[imageUri] != nil || [_pendingAttachmentUris containsObject:imageUri]) {
      continue;
    }

    NSURL *url = [NSURL URLWithString:imageUri];
    if (url == nil) {
      continue;
    }
    if (url.isFileURL) {
      UIImage *image = [UIImage imageWithContentsOfFile:url.path];
      if (image != nil) {
        _attachmentImages[imageUri] = image;
        dispatch_async(dispatch_get_main_queue(), ^{
          [self refreshDisplayedAttachments];
        });
      }
      continue;
    }

    [_pendingAttachmentUris addObject:imageUri];
    [[[NSURLSession sharedSession] dataTaskWithURL:url
                                completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
      UIImage *image = data == nil ? nil : [UIImage imageWithData:data];
      dispatch_async(dispatch_get_main_queue(), ^{
        [self->_pendingAttachmentUris removeObject:imageUri];
        if (image != nil) {
          self->_attachmentImages[imageUri] = image;
          [self refreshDisplayedAttachments];
        }
      });
    }] resume];
  }
}

- (void)refreshDisplayedAttachments
{
  if (!_state || _textView.attributedText == nil) {
    return;
  }

  NSMutableAttributedString *attributedText = [_textView.attributedText mutableCopy];
  E6MarkdownTextApplyAttachments(
      attributedText,
      _state->getData().attachmentRanges,
      _attachmentImages);

  const NSRange savedRange = _textView.selectedRange;
  _suppressSelectionChange = YES;
  _textView.attributedText = attributedText;
  if (savedRange.location != NSNotFound &&
      NSMaxRange(savedRange) <= _textView.attributedText.length) {
    _textView.selectedRange = savedRange;
  }
  _suppressSelectionChange = NO;
  [_textView setNeedsDisplay];
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &oldViewProps = *std::static_pointer_cast<E6MarkdownTextProps const>(_props);
  const auto &newViewProps = *std::static_pointer_cast<E6MarkdownTextProps const>(props);
  if (oldViewProps.contextClipboardConfig != newViewProps.contextClipboardConfig) {
    NSString *config = RCTNSStringFromString(newViewProps.contextClipboardConfig);
    _textView.contextClipboardConfig = config.length ? [NSJSONSerialization JSONObjectWithData:[config dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] : nil;
  }

  if (oldViewProps.numberOfLines != newViewProps.numberOfLines) {
    _textView.textContainer.maximumNumberOfLines = newViewProps.numberOfLines;
  }

  if (oldViewProps.selectable != newViewProps.selectable) {
    _textView.selectable = newViewProps.selectable;
  }

  if (oldViewProps.allowFontScaling != newViewProps.allowFontScaling) {
    if (@available(iOS 11.0, *)) {
      _textView.adjustsFontForContentSizeCategory = newViewProps.allowFontScaling;
    }
  }

  if (oldViewProps.ellipsizeMode != newViewProps.ellipsizeMode) {
    if (newViewProps.ellipsizeMode == E6MarkdownTextEllipsizeMode::Head) {
      _textView.textContainer.lineBreakMode = NSLineBreakMode::NSLineBreakByTruncatingHead;
    } else if (newViewProps.ellipsizeMode == E6MarkdownTextEllipsizeMode::Middle) {
      _textView.textContainer.lineBreakMode = NSLineBreakMode::NSLineBreakByTruncatingMiddle;
    } else if (newViewProps.ellipsizeMode == E6MarkdownTextEllipsizeMode::Tail) {
      _textView.textContainer.lineBreakMode = NSLineBreakMode::NSLineBreakByTruncatingTail;
    } else if (newViewProps.ellipsizeMode == E6MarkdownTextEllipsizeMode::Clip) {
      _textView.textContainer.lineBreakMode = NSLineBreakMode::NSLineBreakByClipping;
    }
  }


  // I'm not sure if this is really the right way to handle this style. This means that the entire _view_ the text
  // is in will have this background color applied. To apply it just to a particular part of a string, you'd need
  // to do <Text><Text style={{backgroundColor: 'blue'}}>Hello</Text></Text>.
  // This is how the base <Text> component works though, so we'll go with it for now. Can change later if we want.
  if (oldViewProps.backgroundColor != newViewProps.backgroundColor) {
    _textView.backgroundColor = RCTUIColorFromSharedColor(newViewProps.backgroundColor);
  }

  [super updateProps:props oldProps:oldProps];
}

// See RCTParagraphComponentView
- (void)updateState:(const facebook::react::State::Shared &)state oldState:(const facebook::react::State::Shared &)oldState
{
  _state = std::static_pointer_cast<const E6MarkdownTextShadowNode::ConcreteState>(state);
  [self setNeedsDisplay];
}

// MARK: - UIGestureRecognizerDelegate

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer shouldRecognizeSimultaneouslyWithGestureRecognizer:(UIGestureRecognizer *)otherGestureRecognizer
{
  return YES;
}

- (BOOL)gestureRecognizerShouldBegin:(UIGestureRecognizer *)gestureRecognizer
{
  if (gestureRecognizer != _longPressGestureRecognizer &&
      gestureRecognizer != _pressGestureRecognizer) {
    return YES;
  }

  const auto location = [self getLocationOfPress:gestureRecognizer];
  const auto child = [self getTouchChild:location];
  return ![child hasContextMenu];
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer shouldReceiveTouch:(UITouch *)touch
{
  return YES;
}

- (void)clearSelectionForOutsideTapWithHitView:(UIView *)hitView
{
  if ([hitView isDescendantOfView:self]) {
    return;
  }
  // Defer past the current event loop turn so any in-flight edit-menu action
  // (Copy / Define / Look Up / …) reads the live selection before we clear it.
  UITextView *textView = _textView;
  dispatch_async(dispatch_get_main_queue(), ^{
    UITextRange *range = textView.selectedTextRange;
    if (range != nil && !range.isEmpty) {
      textView.selectedTextRange = nil;
    }
  });
}

// MARK: - Touch handling

- (nullable E6MarkdownTextRun *)childForCharacterRange:(NSRange)characterRange
{
  NSUInteger location = 0;
  for (UIView *child in self.subviews) {
    if (![child isKindOfClass:[E6MarkdownTextRun class]]) {
      continue;
    }

    E6MarkdownTextRun *textChild = (E6MarkdownTextRun *)child;
    const NSRange range = NSMakeRange(location, textChild.text.length);
    if (NSIntersectionRange(range, characterRange).length > 0) {
      return textChild;
    }
    location = NSMaxRange(range);
  }
  return nil;
}

- (CGPoint)getLocationOfPress:(UIGestureRecognizer*)sender
{
  return [sender locationInView:_textView];
}

- (E6MarkdownTextRun*)getTouchChild:(CGPoint)location
{
  const auto charIndex = [_textView.layoutManager characterIndexForPoint:location
                                                         inTextContainer:_textView.textContainer
                                fractionOfDistanceBetweenInsertionPoints:nil
  ];

  int currIndex = -1;
  for (UIView* child in self.subviews) {
    if (![child isKindOfClass:[E6MarkdownTextRun class]]) {
      continue;
    }

    E6MarkdownTextRun* textChild = (E6MarkdownTextRun*)child;

    // This is UTF16 code units!!
    currIndex += textChild.text.length;

    if (charIndex <= currIndex) {
      return textChild;
    }
  }

  return nil;
}

- (void)handlePressIfNecessary:(UITapGestureRecognizer*)sender
{
  const auto location = [self getLocationOfPress:sender];
  const auto child = [self getTouchChild:location];

  if (child) {
    [child onPress];
  }
}

- (void)handleLongPressIfNecessary:(UILongPressGestureRecognizer*)sender
{
  if (sender.state != UIGestureRecognizerStateBegan) {
    return;
  }

  const auto location = [self getLocationOfPress:sender];
  const auto child = [self getTouchChild:location];

  if (child) {
    [child onLongPress];
  }
}

// MARK: - UITextViewDelegate

- (nullable UIAction *)textView:(UITextView *)textView
    primaryActionForTextItem:(UITextItem *)textItem
               defaultAction:(UIAction *)defaultAction API_AVAILABLE(ios(17.0))
{
  E6MarkdownTextRun *child = [self childForCharacterRange:textItem.range];
  if (![child hasContextMenu] && !child.contextChipInteractive) {
    return defaultAction;
  }

  __weak E6MarkdownTextRun *weakChild = child;
  return [UIAction actionWithHandler:^(__kindof UIAction *action) {
    [weakChild onPress];
  }];
}

- (nullable UITextItemMenuConfiguration *)textView:(UITextView *)textView
                      menuConfigurationForTextItem:(UITextItem *)textItem
                                       defaultMenu:(UIMenu *)defaultMenu API_AVAILABLE(ios(17.0))
{
  E6MarkdownTextRun *child = [self childForCharacterRange:textItem.range];
  UIMenu *menu = [child contextMenu];
  if (child.contextChipInteractive && menu == nil) return nil;
  return [UITextItemMenuConfiguration configurationWithMenu:menu ?: defaultMenu];
}

- (void)textViewDidChangeSelection:(UITextView *)textView
{
  if (_suppressSelectionChange) {
    return;
  }
  if (_eventEmitter == nullptr) {
    return;
  }

  const NSRange selectedRange = textView.selectedRange;
  if (selectedRange.location == NSNotFound) {
    return;
  }

  // Fires on programmatic selection changes too (e.g. the outside-tap clear
  // in handleOutsideTap:), so JS will see a synthetic empty-range event then.
  std::dynamic_pointer_cast<const facebook::react::E6MarkdownTextEventEmitter>(_eventEmitter)
    ->onSelectionChange(facebook::react::E6MarkdownTextEventEmitter::OnSelectionChange{
      static_cast<int>(self.tag),
      static_cast<int>(selectedRange.location),
      static_cast<int>(selectedRange.location + selectedRange.length),
    });
}

Class<RCTComponentViewProtocol> E6MarkdownTextCls(void)
{
  return E6MarkdownText.class;
}

@end
