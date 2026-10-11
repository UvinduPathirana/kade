import type { PageRequest, PageResponse } from "@kade/proto/kade/common/v1/types";
import { invalidArgument } from "../platform/grpc/errors.js";

export interface Page {
  limit: number;
  offset: number;
}

/** Offset cursors, opaque to callers ("o:40" base64url). Good enough for admin lists. */
export function readPage(page: PageRequest | undefined, defaultSize = 20, maxSize = 100): Page {
  const size = page?.pageSize && page.pageSize > 0 ? Math.min(page.pageSize, maxSize) : defaultSize;
  let offset = 0;
  if (page?.pageToken) {
    const raw = Buffer.from(page.pageToken, "base64url").toString("utf8");
    const m = /^o:(\d{1,9})$/.exec(raw);
    if (!m) throw invalidArgument("PAGE_TOKEN_INVALID", "That page token isn't valid.", { field: "page" });
    offset = Number(m[1]);
  }
  return { limit: size, offset };
}

export function pageResponse(p: Page, returned: number, total: number): PageResponse {
  const next = p.offset + returned;
  return {
    nextPageToken: returned > 0 && next < total ? Buffer.from(`o:${next}`).toString("base64url") : "",
    totalSize: total,
  };
}
