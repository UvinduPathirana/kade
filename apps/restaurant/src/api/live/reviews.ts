// Reviews and public replies over gateway-merchant (review service).
import { enc, get, put } from "../http";
import type { Review } from "../types";

export const listReviews = () => get<Review[]>("/v1/reviews");

export const replyToReview = ({ id, text }: { id: string; text: string }) =>
  put<Review>(`/v1/reviews/${enc(id)}/reply`, { text });
