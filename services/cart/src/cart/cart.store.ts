import { status } from "@grpc/grpc-js";
import { Inject, Injectable } from "@nestjs/common";
import { Cart } from "@kade/proto/kade/cart/v1/cart_service";
import { CONFIG, type Config } from "../platform/config.js";
import { aborted, DomainError } from "../platform/grpc/errors.js";
import { RedisClient } from "../platform/redis/redis.js";
import { emptyCart } from "./cart.js";

// Compare-and-set: write only if nobody changed the cart since we read it. Lua runs atomically in
// Redis, which (unlike WATCH) is safe on the one connection all requests share.
const CAS = `
local v = redis.call('HGET', KEYS[1], 'v')
if (v or '0') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'v', ARGV[2], 'data', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1`;

const MAX_ATTEMPTS = 10;
/** Random 2–20 ms pause between attempts so racing writers spread out instead of colliding again. */
const backoff = (): Promise<void> => new Promise((r) => setTimeout(r, 2 + Math.random() * 18));

export interface StoredCart {
  cart: Cart;
  version: number;
}

/**
 * One cart per customer in a Redis hash `cart:{customerId}` = { v: version, data: Cart JSON },
 * expiring CART_TTL_SECONDS after the last write.
 */
@Injectable()
export class CartStore {
  private readonly ttlSeconds: number;

  constructor(
    @Inject(RedisClient) private readonly client: RedisClient,
    @Inject(CONFIG) config: Config,
  ) {
    this.ttlSeconds = config.CART_TTL_SECONDS;
  }

  static key(customerId: string): string {
    return `cart:${customerId}`;
  }

  async get(customerId: string): Promise<StoredCart> {
    const [v, data] = await this.redisCall(() =>
      this.client.redis.hmget(CartStore.key(customerId), "v", "data"),
    );
    if (!data) return { cart: emptyCart(customerId), version: 0 };
    return { cart: { ...Cart.fromJSON(JSON.parse(data)), customerId }, version: Number(v ?? 0) };
  }

  /**
   * Read → mutate → compare-and-set, retried when another request got there first. `mutate` must be
   * pure (it may run more than once) and may throw DomainErrors to reject the change.
   */
  async update(customerId: string, mutate: (cart: Cart) => Cart): Promise<Cart> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { cart, version } = await this.get(customerId);
      const now = new Date();
      const next: Cart = {
        ...mutate(cart),
        customerId,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000),
      };
      const ok = await this.redisCall(() =>
        this.client.redis.eval(
          CAS,
          1,
          CartStore.key(customerId),
          String(version),
          String(version + 1),
          JSON.stringify(Cart.toJSON(next)),
          String(this.ttlSeconds),
        ),
      );
      if (ok === 1) return next;
      await backoff();
    }
    throw aborted("CART_CONFLICT", "Your cart changed in another tab. Try again.");
  }

  private async redisCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch {
      // The Redis client logs the underlying error; callers get a stable, user-safe one.
      throw new DomainError(
        status.UNAVAILABLE,
        "CART_STORE_UNAVAILABLE",
        "We couldn't load your cart right now. Try again in a moment.",
      );
    }
  }
}
