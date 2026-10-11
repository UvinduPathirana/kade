// Package idempotency makes retryable mutating RPCs safe: the first request with a key does the
// work and stores its response in the same transaction; retries get that response back.
//
//	err := db.InTx(ctx, pool, func(tx pgx.Tx) error {
//	    prior, replay, err := idempotency.Claim(ctx, tx, "CreateNote", key, idempotency.Hash(req))
//	    if err != nil { return err }
//	    if replay { return proto.Unmarshal(prior, resp) }
//	    ... do the work, build resp ...
//	    return idempotency.Complete(ctx, tx, "CreateNote", key, resp)
//	})
//
// Concurrency: Claim inserts the key first. A concurrent request with the same key blocks on the
// primary key until the first transaction finishes, then sees the committed response (or, if the
// first one rolled back, claims the key itself).
package idempotency

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/proto"
)

// ErrKeyReused means the same key was sent with a different request body.
var ErrKeyReused = errors.New("idempotency key reused with a different request")

// Hash fingerprints a request (deterministic proto encoding). Clear the idempotency_key field
// first, or pass a clone without it, so the key itself does not affect the hash.
func Hash(m proto.Message) []byte {
	b, _ := proto.MarshalOptions{Deterministic: true}.Marshal(m)
	sum := sha256.Sum256(b)
	return sum[:]
}

// Claim reserves (scope, key). replay=false means this call owns the key and should do the work;
// replay=true returns the stored response of the request that already handled it.
func Claim(ctx context.Context, tx pgx.Tx, scope, key string, requestHash []byte) (response []byte, replay bool, err error) {
	tag, err := tx.Exec(ctx,
		`INSERT INTO idempotency_keys (scope, key, request_hash, response) VALUES ($1, $2, $3, '') ON CONFLICT DO NOTHING`,
		scope, key, requestHash)
	if err != nil {
		return nil, false, fmt.Errorf("claim idempotency key: %w", err)
	}
	if tag.RowsAffected() == 1 {
		return nil, false, nil
	}
	var storedHash []byte
	if err := tx.QueryRow(ctx, `SELECT request_hash, response FROM idempotency_keys WHERE scope = $1 AND key = $2`,
		scope, key).Scan(&storedHash, &response); err != nil {
		return nil, false, fmt.Errorf("read idempotency key: %w", err)
	}
	if string(storedHash) != string(requestHash) {
		return nil, false, ErrKeyReused
	}
	return response, true, nil
}

// Complete stores the response for a key claimed in this transaction.
func Complete(ctx context.Context, tx pgx.Tx, scope, key string, response proto.Message) error {
	b, err := proto.Marshal(response)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE idempotency_keys SET response = $3 WHERE scope = $1 AND key = $2`, scope, key, b)
	return err
}
