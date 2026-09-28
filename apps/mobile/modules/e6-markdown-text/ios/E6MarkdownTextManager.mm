#import <React/RCTViewManager.h>
#import <React/RCTUIManager.h>
#import "RCTBridge.h"
#import "Utils.h"

@interface E6MarkdownTextManager : RCTViewManager
@end

@implementation E6MarkdownTextManager

RCT_EXPORT_MODULE(E6MarkdownText)

- (UIView *)view
{
  return [[UIView alloc] init];
}

RCT_CUSTOM_VIEW_PROPERTY(color, NSString, UIView)
{
}

@end

@interface E6MarkdownTextRunManager : RCTViewManager
@end

@implementation E6MarkdownTextRunManager

RCT_EXPORT_MODULE(E6MarkdownTextRun)

- (UIView *)view
{
  return nil;
}

@end
