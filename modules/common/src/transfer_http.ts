/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {
  HTTP_INTERCEPTORS,
  HttpEvent,
  HttpHandler,
  HttpHeaders,
  HttpInterceptor,
  HttpParams,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { ApplicationRef, Injectable, NgModule } from '@angular/core';
import { StateKey, TransferState, makeStateKey } from '@angular/platform-browser';
import { Observable, of as observableOf } from 'rxjs';
import { defaultIfEmpty, first, tap } from 'rxjs/operators';

type ResponseType = HttpRequest<unknown>['responseType'];

interface TransferHttpResponse {
  body: any;
  headers: Record<string, string[]>;
  status?: number;
  statusText?: string;
  url?: string;
  responseType?: ResponseType;
}

function getHeadersMap(headers: HttpHeaders): Record<string, string[]> {
  const headersMap: Record<string, string[]> = {};
  for (const key of headers.keys()) {
    const values = headers.getAll(key);
    if (values !== null) {
      headersMap[key] = values;
    }
  }

  return headersMap;
}

@Injectable()
export class TransferHttpCacheInterceptor implements HttpInterceptor {
  private isCacheActive = true;

  private makeCacheKey(
    method: string,
    url: string,
    params: HttpParams,
    responseType: ResponseType,
  ): StateKey<TransferHttpResponse> {
    // make the params encoded same as a url so it's easy to identify
    const encodedParams = params
      .keys()
      .sort()
      .map((k) => `${k}=${params.getAll(k)}`)
      .join('&');

    const key = (method === 'GET' ? 'G.' : 'H.') + responseType + '.' + url + '?' + encodedParams;

    return makeStateKey<TransferHttpResponse>(key);
  }

  constructor(appRef: ApplicationRef, private transferState: TransferState) {
    // Stop using the cache if the application has stabilized, indicating initial rendering is
    // complete.
    appRef.isStable
      .pipe(
        first((isStable) => isStable),
        defaultIfEmpty(false),
      )
      .subscribe(() => {
        this.isCacheActive = false;
      });
  }

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if (!this.isCacheActive || (req.method !== 'GET' && req.method !== 'HEAD')) {
      // Cache is no longer active or method is not HEAD or GET.
      // Pass the request through.
      return next.handle(req);
    }

    const storeKey = this.makeCacheKey(req.method, req.url, req.params, req.responseType);

    if (this.transferState.hasKey(storeKey)) {
      // Request found in cache. Respond using it.
      const response = this.transferState.get(storeKey, null);
      let body: ArrayBuffer | Blob | string | undefined = response?.body;

      switch (response?.responseType) {
        case 'arraybuffer':
          body = new TextEncoder().encode(response.body).buffer;
          break;
        case 'blob':
          body = new Blob([response.body]);
          break;
      }

      return observableOf(
        new HttpResponse<any>({
          body,
          headers: new HttpHeaders(response?.headers),
          status: response?.status,
          statusText: response?.statusText,
          url: response?.url,
        }),
      );
    } else {
      // Request not found in cache. Make the request and cache it.
      const httpEvent = next.handle(req);

      return httpEvent.pipe(
        tap((event: HttpEvent<unknown>) => {
          if (event instanceof HttpResponse) {
            this.transferState.set<TransferHttpResponse>(storeKey, {
              body: event.body,
              headers: getHeadersMap(event.headers),
              status: event.status,
              statusText: event.statusText,
              url: event.url || '',
              responseType: req.responseType,
            });
          }
        }),
      );
    }
  }
}

/**
 * An NgModule used in conjunction with `ServerTransferHttpCacheModule` to transfer cached HTTP
 * calls from the server to the client application.
 */
@NgModule({
  providers: [
    ApplicationRef,
    TransferState,
    TransferHttpCacheInterceptor,
    { provide: HTTP_INTERCEPTORS, useExisting: TransferHttpCacheInterceptor, multi: true },
  ],
})
export class TransferHttpCacheModule {}
