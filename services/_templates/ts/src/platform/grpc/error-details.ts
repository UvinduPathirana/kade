import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";

// Hand-rolled google.rpc.Status / google.protobuf.Any / google.rpc.ErrorInfo codecs: the generated
// @kade/proto package does not include googleapis' rpc protos. Field numbers are from
// google/rpc/status.proto and google/rpc/error_details.proto. This is the gRPC "rich error model":
// the bytes travel in the `grpc-status-details-bin` trailer and every language's client can read them.

export const STATUS_DETAILS_KEY = "grpc-status-details-bin";
export const ERROR_INFO_TYPE_URL = "type.googleapis.com/google.rpc.ErrorInfo";

export interface ErrorInfo {
  /** Stable, UPPER_SNAKE machine code, e.g. NOTE_NOT_FOUND. Gateways map it to user-facing text. */
  reason: string;
  /** The service that produced it, e.g. "template-ts". */
  domain: string;
  metadata: Record<string, string>;
}

export function encodeStatus(code: number, message: string, info: ErrorInfo): Buffer {
  const errorInfo = new BinaryWriter();
  errorInfo.uint32(10).string(info.reason);
  errorInfo.uint32(18).string(info.domain);
  for (const [k, v] of Object.entries(info.metadata)) {
    errorInfo.uint32(26).fork().uint32(10).string(k).uint32(18).string(v).join();
  }
  const status = new BinaryWriter();
  status.uint32(8).int32(code);
  status.uint32(18).string(message);
  status.uint32(26).fork().uint32(10).string(ERROR_INFO_TYPE_URL).uint32(18).bytes(errorInfo.finish()).join();
  return Buffer.from(status.finish());
}

/** Extracts the first ErrorInfo from an encoded google.rpc.Status, if any. */
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
    switch (tag >>> 3) {
      case 1:
        info.reason = r.string();
        break;
      case 2:
        info.domain = r.string();
        break;
      case 3: {
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
        break;
      }
      default:
        r.skip(tag & 7);
    }
  }
  return info;
}
