#pragma once

#include "E6MarkdownTextRunShadowNode.h"

#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>

namespace facebook::react {
using E6MarkdownTextRunComponentDescriptor = ConcreteComponentDescriptor<E6MarkdownTextRunShadowNode>;

void E6MarkdownTextRunSpec_registerComponentDescriptorsFromCodegen(
  std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);
}
