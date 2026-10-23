import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { redactSensitiveRequestUrl } from "./requestUrlRedaction.ts";

it.effect("redacts a websocket ticket from the traced url after the handler reads it", () =>
  Effect.gen(function* () {
    const ticket = "ws-ticket-secret-value";
    const spans: Array<Tracer.NativeSpan> = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    const ambientParent = Tracer.externalSpan({
      traceId: "00000000000000000000000000000001",
      spanId: "0000000000000001",
      sampled: true,
    });
    let handlerUrl = "";
    const request = HttpServerRequest.fromWeb(
      new Request(`https://e6.local/ws?wsTicket=${ticket}&keep=visible`),
    );
    const handler = redactSensitiveRequestUrl(
      Effect.gen(function* () {
        const current = yield* HttpServerRequest.HttpServerRequest;
        handlerUrl = current.url;
        return HttpServerResponse.empty();
      }),
    );

    yield* HttpMiddleware.tracer(handler).pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      Effect.provideService(Tracer.Tracer, tracer),
      Effect.provideService(Tracer.ParentSpan, ambientParent),
      Effect.ensuring(Effect.yieldNow),
    );

    assert.equal(handlerUrl, `/ws?wsTicket=${ticket}&keep=visible`);
    const query = spans[0]?.attributes.get("url.query");
    const full = spans[0]?.attributes.get("url.full");
    assert.equal(typeof query, "string");
    assert.equal(typeof full, "string");
    assert.include(String(query), "wsTicket=[redacted]");
    assert.include(String(query), "keep=visible");
    assert.notInclude(String(query), ticket);
    assert.notInclude(String(full), ticket);
    assert.isTrue(Option.isSome(Option.fromNullishOr(spans[0])));
  }),
);
