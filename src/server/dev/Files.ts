/**
 * @module Files
 */

import etag from 'etag';
import { Stats } from 'fs';
import destroy from 'destroy';
import { Context } from 'koa';
import { PassThrough } from 'stream';
import parseRange from 'range-parser';
import { FilesOptions } from './interface';
import { generate } from './utils/boundary';
import { extname, join, resolve } from 'path';
import { isETag, isETagFresh } from './utils/http';
import { fstat, hasTrailingSlash, isFunction, isOutRoot, isString, unixify } from './utils/common';

interface Range {
  start: number;
  end?: number;
  prefix?: string;
  suffix?: string;
}

type Ranges = Range[] | -1 | -2;

/**
 * @class Files
 */
export default class Files {
  private root: string;
  private options: FilesOptions;

  /**
   * @constructor
   * @description Create files service.
   * @param root Files service root.
   * @param options Files service options.
   */
  constructor(root: string, options: FilesOptions) {
    this.options = options;
    this.root = unixify(resolve(root));
  }

  /**
   * @private
   * @method isConditionalGET
   * @description Check if request is conditional GET.
   * @param context Koa context.
   */
  private isConditionalGET(context: Context): boolean {
    const { request } = context;

    return !!(
      request.get('If-Match') ||
      request.get('If-None-Match') ||
      request.get('If-Modified-Since') ||
      request.get('if-Unmodified-Since')
    );
  }

  /**
   * @private
   * @method isPreconditionFailure
   * @description Check if request precondition failure.
   * @param context Koa context.
   */
  private isPreconditionFailure(context: Context): boolean {
    const { request, response } = context;

    // If-Match.
    const match = request.get('If-Match');

    if (match) {
      const etag = response.get('ETag');

      return !etag || (match !== '*' && !isETagFresh(match, etag));
    }

    // If-Unmodified-Since.
    const unmodifiedSince = Date.parse(request.get('If-Unmodified-Since'));

    if (!isNaN(unmodifiedSince)) {
      const lastModified = Date.parse(response.get('Last-Modified'));

      return isNaN(lastModified) || lastModified > unmodifiedSince;
    }

    return false;
  }

  /**
   * @private
   * @method isRangeFresh
   * @description Check if request range fresh.
   * @param context Koa context.
   */
  private isRangeFresh(context: Context): boolean {
    const { request, response } = context;
    const ifRange = request.get('If-Range');

    // No If-Range.
    if (!ifRange) {
      return true;
    }

    // If-Range as etag.
    if (isETag(ifRange)) {
      const etag = response.get('ETag');

      return !!(etag && isETagFresh(ifRange, etag));
    }

    // If-Range as modified date.
    const lastModified = response.get('Last-Modified');

    return Date.parse(lastModified) <= Date.parse(ifRange);
  }

  /**
   * @private
   * @method parseRange
   * @description Parse range.
   * @param context Koa context.
   * @param stats File stats.
   */
  private parseRange(context: Context, stats: Stats): Ranges {
    const { size } = stats;

    // Range support.
    if (this.options.acceptRanges !== false) {
      const range = context.request.get('Range');

      // Range fresh.
      if (range && this.isRangeFresh(context)) {
        // Parse range -1 -2 or [].
        const parsed = parseRange(size, range, { combine: true });

        // -1 signals an unsatisfiable range.
        // -2 signals a malformed header string.
        if (parsed === -1 || parsed === -2) {
          return parsed;
        }

        // Ranges ok, support multiple ranges.
        if (parsed.type === 'bytes') {
          // Set 206 status.
          context.status = 206;

          const { length } = parsed;

          // Multiple ranges.
          if (length > 1) {
            // Content-Length.
            let contentLength = 0;

            // Ranges.
            const ranges: Range[] = [];
            // Range boundary.
            const boundary = `<${generate()}>`;
            // Range suffix.
            const suffix = `\r\n--${boundary}--\r\n`;
            // Multipart Content-Type.
            const contentType = `Content-Type: ${context.type}`;

            // Override Content-Type.
            context.type = `multipart/byteranges; boundary=${boundary}`;

            // Map ranges.
            for (let index = 0; index < length; index++) {
              const { start, end } = parsed[index];
              // The first prefix boundary no \r\n.
              const prefixHead = index > 0 ? '\r\n' : '';
              const contentRange = `Content-Range: bytes ${start}-${end}/${size}`;
              const prefix = `${prefixHead}--${boundary}\r\n${contentType}\r\n${contentRange}\r\n\r\n`;

              // Compute Content-Length
              contentLength += end - start + 1 + Buffer.byteLength(prefix);

              // Cache range.
              ranges.push({ start, end, prefix });
            }

            // The last add suffix boundary.
            ranges[length - 1].suffix = suffix;
            // Compute Content-Length.
            contentLength += Buffer.byteLength(suffix);
            // Set Content-Length.
            context.length = contentLength;

            // Return ranges.
            return ranges;
          } else {
            const [{ start, end }] = parsed;

            // Set Content-Length.
            context.length = end - start + 1;

            // Set Content-Range.
            context.set('Content-Range', `bytes ${start}-${end}/${size}`);

            // Return ranges.
            return parsed;
          }
        }
      }
    }

    // Set Content-Length.
    context.length = size;

    // Return ranges.
    return [{ start: 0, end: Math.max(size - 1) }];
  }

  /**
   * @private
   * @method setupHeaders
   * @description Setup headers
   * @param context Koa context
   * @param path File path
   * @param stats File stats
   */
  private setupHeaders(context: Context, path: string, stats: Stats): void {
    const { options } = this;
    const { headers, cacheControl } = options;

    // Set headers.
    if (headers) {
      if (isFunction(headers)) {
        context.set(headers(path, stats));
      } else {
        context.set(headers);
      }
    }

    // Set status.
    context.status = 200;

    // Set Content-Type.
    context.type = extname(path);

    // ETag.
    if (options.etag === false) {
      context.remove('ETag');
    } else {
      // Set ETag.
      context.set('ETag', etag(stats));
    }

    // Accept-Ranges.
    if (options.acceptRanges === false) {
      context.remove('Accept-Ranges');
    } else {
      // Set Accept-Ranges.
      context.set('Accept-Ranges', 'bytes');
    }

    // Cache-Control.
    if (cacheControl && isString(cacheControl)) {
      // Set Cache-Control.
      context.set('Cache-Control', cacheControl);
    }

    // Last-Modified.
    if (options.lastModified === false) {
      context.remove('Last-Modified');
    } else {
      // Set mtime utc string.
      context.set('Last-Modified', stats.mtime.toUTCString());
    }
  }

  /**
   * @private
   * @method readTo
   * @description Read file.
   * @param stream Destination stream.
   * @param path File path.
   * @param range Read range.
   * @param end Is destory destination stream after read.
   */
  private readTo(stream: PassThrough, path: string, range: Range, end: boolean): Promise<true> {
    const { fs } = this.options;

    return new Promise((resolve, reject): void => {
      // Create file stream.
      const file = fs.createReadStream(path, range);

      // File read stream open.
      if (range.prefix) {
        file.once('open', () => {
          // Write prefix boundary.
          stream.write(range.prefix);
        });
      }

      // File read stream error.
      file.once('error', error => {
        // Unpipe.
        file.unpipe(stream);
        // Reject.
        reject(error);
        // Destroy file stream.
        destroy(file);
      });

      // File read stream end.
      if (range.suffix) {
        file.once('end', () => {
          // Push suffix boundary.
          stream.write(range.suffix);
        });
      }

      // File read stream close.
      file.once('close', () => {
        // Unpipe.
        file.unpipe(stream);
        // Resolve.
        resolve(true);
        // Destroy file stream.
        destroy(file);
      });

      // Write data to buffer.
      file.pipe(stream, { end });
    });
  }

  /**
   * @private
   * @method send
   * @description Send file.
   * @param context Koa context.
   * @param path File path.
   * @param ranges Read ranges.
   */
  private async send(context: Context, path: string, ranges: Range[]): Promise<void> {
    // Set stream body, highWaterMark 64kb.
    const stream = new PassThrough({
      highWaterMark: 65536
    });

    // Set response body.
    context.body = stream;

    // Ranges length.
    let { length } = ranges;

    // Read file ranges.
    try {
      for (const range of ranges) {
        await this.readTo(stream, path, range, --length === 0);
      }
    } catch {
      // End stream when read exception.
      stream.end();
    }
  }

  /**
   * @public
   * @method response
   * @description Response to koa context.
   * @param context Koa context.
   */
  public async response(context: Context): Promise<boolean> {
    const { root } = this;

    // Only support GET and HEAD (405).
    if (context.method !== 'GET' && context.method !== 'HEAD') {
      return false;
    }

    // Get path of file.
    const path = unixify(join(root, context.path));

    // Malicious path (403).
    if (isOutRoot(path, root)) {
      return false;
    }

    // Get file system.
    const { fs } = this.options;

    // File stats.
    let stats: Stats | undefined;

    // Get file stats.
    try {
      stats = await fstat(fs, path);
    } catch {
      // 404 | 500.
      return false;
    }

    // File not exist (404 | 500).
    if (!stats) {
      return false;
    }

    // Is directory (403).
    if (stats.isDirectory()) {
      return false;
    }

    // Not a directory but has trailing slash (404).
    if (hasTrailingSlash(path)) {
      return false;
    }

    // Setup headers.
    this.setupHeaders(context, path, stats);

    // Conditional get support.
    if (this.isConditionalGET(context)) {
      // Request precondition failure.
      if (this.isPreconditionFailure(context)) {
        return context.throw(412);
      }

      // Request fresh (304).
      if (context.fresh) {
        // Set status.
        context.status = 304;
        // Set body null.
        context.body = null;

        return true;
      }
    }

    // Head request.
    if (context.method === 'HEAD') {
      // Set Content-Length.
      context.length = stats.size;
      // Set body null
      context.body = null;

      return true;
    }

    // Parsed ranges.
    const ranges = this.parseRange(context, stats);

    // 416
    if (ranges === -1) {
      // Set Content-Range.
      context.set('Content-Range', `bytes */${stats.size}`);

      // Unsatisfiable 416.
      return context.throw(416);
    }

    // 400.
    if (ranges === -2) {
      return context.throw(400);
    }

    // Send file.
    this.send(context, path, ranges);

    return true;
  }
}
