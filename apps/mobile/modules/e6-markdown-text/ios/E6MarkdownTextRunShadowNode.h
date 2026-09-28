#pragma once

#include <react/renderer/components/E6MarkdownTextSpec/EventEmitters.h>
#include <react/renderer/components/E6MarkdownTextSpec/Props.h>
#include <react/renderer/components/E6MarkdownTextSpec/States.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>

namespace facebook::react {
extern const char E6MarkdownTextRunComponentName[];

using E6MarkdownTextRunShadowNode = ConcreteViewShadowNode<
    E6MarkdownTextRunComponentName,
    E6MarkdownTextRunProps,
    E6MarkdownTextRunEventEmitter,
    E6MarkdownTextRunState>;
}
