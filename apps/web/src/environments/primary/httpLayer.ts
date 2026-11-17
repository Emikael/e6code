import { remoteHttpClientLayer } from "@e6tools/client-runtime/rpc";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
} from "effect/unstable/http";

import { readDesktopPrimaryBearerToken } from "./desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "./target";

function isSameOriginBrowserPrimary(): boolean {
  if (
    typeof window === "undefined" ||
    window.desktopBridge !== undefined ||
    !window.location.origin.startsWith("http")
  ) {
    return false;
  }

  return new URL(resolvePrimaryEnvironmentHttpUrl("/")).origin === window.location.origin;
}

/**
 * Adds the bearer token the desktop mints for its local environment. Minting needs the
 * backend, so it fails while the backend is starting; that failure is the request's own
 * transport failure, never a defect that would end whoever is waiting on the request.
 */
function withPrimaryBearerToken(client: HttpClient.HttpClient): HttpClient.HttpClient {
  return client.pipe(
    HttpClient.mapRequestEffect((request) =>
      Effect.tryPromise({
        try: readDesktopPrimaryBearerToken,
        catch: (cause) =>
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause,
              description: "Could not load the desktop primary credential.",
            }),
          }),
      }).pipe(
        Effect.map((bearerToken) =>
          bearerToken ? HttpClientRequest.bearerToken(request, bearerToken) : request,
        ),
      ),
    ),
  );
}

export function makePrimaryEnvironmentHttpLayer() {
  return Layer.unwrap(
    Effect.sync(() => {
      const baseLayer = remoteHttpClientLayer(globalThis.fetch);
      if (isSameOriginBrowserPrimary()) {
        return Layer.merge(
          baseLayer,
          Layer.succeed(FetchHttpClient.RequestInit, { credentials: "include" }),
        );
      }

      const bearerClientLayer = Layer.effect(
        HttpClient.HttpClient,
        Effect.map(HttpClient.HttpClient, withPrimaryBearerToken),
      ).pipe(Layer.provide(baseLayer));

      return Layer.merge(
        bearerClientLayer,
        Layer.succeed(FetchHttpClient.RequestInit, { credentials: "omit" }),
      );
    }),
  );
}

export const primaryEnvironmentHttpLayer = makePrimaryEnvironmentHttpLayer();
