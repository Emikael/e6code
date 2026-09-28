// This guard prevent this file to be compiled in the old architecture.
#ifdef RCT_NEW_ARCH_ENABLED
#import <React/RCTViewComponentView.h>
#import <React/RCTComponent.h>
#import <UIKit/UIKit.h>

#ifndef E6MarkdownTextRunNativeComponent_h
#define E6MarkdownTextRunNativeComponent_h

NS_ASSUME_NONNULL_BEGIN

@interface E6MarkdownTextRun : RCTViewComponentView

@property (nonatomic, copy, nullable) NSString *text;
@property (nonatomic, assign) BOOL contextChipInteractive;

- (nullable UIMenu *)contextMenu;
- (BOOL)hasContextMenu;
- (void)onContextMenuAction:(NSString *)actionIdentifier;
- (void)onPress;
- (void)onLongPress;

@end

NS_ASSUME_NONNULL_END

#endif /* UitextviewViewNativeComponent_h */
#endif /* RCT_NEW_ARCH_ENABLED */
