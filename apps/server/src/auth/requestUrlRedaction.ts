import * as Effect from "effect/Effect";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import { redactSensitiveUrl } from "@e6tools/shared/httpObservability";

const assignRedactedUrl = (request: HttpServerRequest.HttpServerRequest): void => {
  const redactedUrl = redactSensitiveUrl(request.url);
  try {
    (request as { url: string }).url = redactedUrl;
  } catch {
    // Some request implementations expose `url` as a getter.
  }
};

/**
 * The handler still reads the real query. The URL is rewritten after the
 * handler returns and before Effect's HTTP tracer records `url.full`.
 */
export const redactSensitiveRequestUrl = HttpMiddleware.make((httpEffect) =>
  Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
    httpEffect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          assignRedactedUrl(request);
        }),
      ),
    ),
  ),
);
