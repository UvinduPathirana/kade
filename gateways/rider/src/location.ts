import type { ClientWritableStream } from "@grpc/grpc-js";
import type { RiderActivity, RiderLocation } from "@kade/proto/kade/location/v1/location_events";
import type {
  LocationServiceClient,
  StreamRiderLocationsRequest,
} from "@kade/proto/kade/location/v1/location_service";
import type { Logger } from "pino";
import type { Identity } from "./auth.js";
import { identityMetadata } from "./grpc/call.js";

const IDLE_CLOSE_MS = 60_000;
// After the location service refused or dropped a stream, wait before trying again.
const RETRY_AFTER_MS = 10_000;

export interface Fix {
  lat: number;
  lng: number;
  heading?: number;
  speedMps?: number;
  accuracyM?: number;
  at?: number;
  deliveryId?: string;
  activity?: RiderActivity;
}

interface Stream {
  call: ClientWritableStream<StreamRiderLocationsRequest>;
  idle: NodeJS.Timeout;
}

/**
 * Forwards rider GPS to the location service: one long-lived client stream per rider
 * (LocationService.StreamRiderLocations), closed after a minute of silence. While location is down
 * or not built yet, fixes are dropped quietly (the app keeps working; dispatch still has the
 * position from SetAvailability).
 */
export class LocationForwarder {
  private readonly streams = new Map<string, Stream>();
  private readonly sequence = new Map<string, number>();
  private downUntil = 0;

  constructor(
    private readonly client: LocationServiceClient,
    private readonly logger: Logger,
  ) {}

  /** True when the fix was handed to the location service. */
  send(identity: Identity, riderId: string, fix: Fix): boolean {
    if (Date.now() < this.downUntil) return false;
    const seq = (this.sequence.get(riderId) ?? 0) + 1;
    this.sequence.set(riderId, seq);
    const location: RiderLocation = {
      riderId,
      position: { lat: fix.lat, lng: fix.lng },
      heading: fix.heading ?? -1,
      speedMps: fix.speedMps ?? 0,
      accuracyM: fix.accuracyM ?? 0,
      occurredAt: new Date(fix.at ?? Date.now()),
      receivedAt: undefined,
      deliveryId: fix.deliveryId ?? "",
      orderId: "",
      activity: fix.activity ?? 0,
      // Monotonic per rider across gateway restarts too.
      sequence: Date.now() * 10 + (seq % 10),
    };
    const stream = this.open(identity, riderId);
    if (!stream) return false;
    clearTimeout(stream.idle);
    stream.idle = setTimeout(() => this.close(riderId), IDLE_CLOSE_MS);
    stream.call.write({ location });
    return true;
  }

  closeAll(): void {
    for (const id of [...this.streams.keys()]) this.close(id);
  }

  private open(identity: Identity, riderId: string): Stream | undefined {
    const existing = this.streams.get(riderId);
    if (existing) return existing;
    try {
      const call = this.client.streamRiderLocations(identityMetadata(identity), {}, (err, res) => {
        this.streams.delete(riderId);
        if (err) {
          this.downUntil = Date.now() + RETRY_AFTER_MS;
          this.logger.debug({ code: err.code }, "location stream ended with an error");
        } else {
          this.logger.debug(
            { riderId, accepted: res.accepted, dropped: res.dropped },
            "location stream closed",
          );
        }
      });
      call.on("error", () => undefined); // reported through the callback
      const stream: Stream = { call, idle: setTimeout(() => this.close(riderId), IDLE_CLOSE_MS) };
      this.streams.set(riderId, stream);
      return stream;
    } catch (err) {
      this.logger.warn({ err }, "could not open a location stream");
      this.downUntil = Date.now() + RETRY_AFTER_MS;
      return undefined;
    }
  }

  private close(riderId: string): void {
    const s = this.streams.get(riderId);
    if (!s) return;
    clearTimeout(s.idle);
    this.streams.delete(riderId);
    s.call.end();
  }
}
