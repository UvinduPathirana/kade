import type { PageRequest, PageResponse } from "@kade/proto/kade/common/v1/types";
import { invalidArgument } from "../platform/grpc/errors.js";

/** Offset paging behind an opaque token ("o:<offset>" base64url). Lists here are small (admin queues). */
export function decodePage(
  page: PageRequest | undefined,
  defaultSize: number,
  maxSize: number,
): { offset: number; size: number } {
  const size = Math.min(maxSize, page?.pageSize && page.pageSize > 0 ? page.pageSize : defaultSize);
  if (!page?.pageToken) return { offset: 0, size };
  const decoded = Buffer.from(page.pageToken, "base64url").toString("utf8");
  const m = /^o:(\d{1,9})$/.exec(decoded);
  if (!m)
    throw invalidArgument("PAGE_TOKEN_INVALID", "That page link has expired.", { field: "page.page_token" });
  return { offset: Number(m[1]), size };
}

export function encodePage(offset: number, returned: number, total: number): PageResponse {
  const next = offset + returned;
  return {
    nextPageToken: returned > 0 && next < total ? Buffer.from(`o:${next}`).toString("base64url") : "",
    totalSize: total,
  };
}
