import { BinaryReader } from "@bufbuild/protobuf/wire";

// Reads google.rpc.ErrorInfo out of the `grpc-status-details-bin` trailer that services attach
// (see services/_templates/ts/src/platform/grpc/error-details.ts for the writer). Hand-rolled
// because @kade/proto does not include googleapis' rpc protos.

export const STATUS_DETAILS_KEY = "grpc-status-details-bin";
const ERROR_INFO_TYPE_URL = "type.googleapis.com/google.rpc.ErrorInfo";

export interface ErrorInfo {
  reason: string;
  domain: string;
  metadata: Record<string, string>;
}

export function decodeErrorInfo(statusBytes: Uint8Array): ErrorInfo | undefined {
  const status = new BinaryReader(statusBytes);
  while (status.pos < status.len) {
    const tag = status.uint32();
    if (tag >>> 3 !== 3) {
      status.skip(tag & 7);
      continue;
    }
    const any = new BinaryReader(status.bytes());
    let typeUrl = "";
    let value: Uint8Array | undefined;
    while (any.pos < any.len) {
      const t = any.uint32();
      if (t >>> 3 === 1) typeUrl = any.string();
      else if (t >>> 3 === 2) value = any.bytes();
      else any.skip(t & 7);
    }
    if (typeUrl === ERROR_INFO_TYPE_URL && value) return readErrorInfo(value);
  }
  return undefined;
}

function readErrorInfo(bytes: Uint8Array): ErrorInfo {
  const r = new BinaryReader(bytes);
  const info: ErrorInfo = { reason: "", domain: "", metadata: {} };
  while (r.pos < r.len) {
    const tag = r.uint32();
    if (tag >>> 3 === 1) info.reason = r.string();
    else if (tag >>> 3 === 2) info.domain = r.string();
    else if (tag >>> 3 === 3) {
      const entry = new BinaryReader(r.bytes());
      let key = "";
      let val = "";
      while (entry.pos < entry.len) {
        const t = entry.uint32();
        if (t >>> 3 === 1) key = entry.string();
        else if (t >>> 3 === 2) val = entry.string();
        else entry.skip(t & 7);
      }
      info.metadata[key] = val;
    } else r.skip(tag & 7);
  }
  return info;
}
