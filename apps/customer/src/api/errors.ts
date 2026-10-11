// Errors the API functions throw, the same in mock and live mode. Pages switch on the class.

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

export class OrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderError";
  }
}

/** The bank said no. Checkout offers another way to pay. */
export class PaymentDeclinedError extends OrderError {
  constructor(message: string) {
    super(message);
    this.name = "PaymentDeclinedError";
  }
}

export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountError";
  }
}

export class GroupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroupError";
  }
}

/** A problem+json answer from the gateway. `code` is stable; `message` is safe to show. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
