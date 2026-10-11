/** An error whose message is written for staff and safe to show as-is. */
export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}
