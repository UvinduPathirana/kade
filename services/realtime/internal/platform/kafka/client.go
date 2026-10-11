// Package kafka holds the Kafka patterns every Go service copies:
//
//   - Consumer: idempotent, group = SERVICE_NAME, decode by the eventType header, dedup through
//     processed_events in the same tx as the side effects, retry with backoff, then <topic>.dlq.
//   - StreamProducer: direct high-throughput produce with the Confluent wire format and the
//     Schema Registry (Protobuf), the pattern for kade.rider.locations. Business events go through
//     the outbox instead (package outbox), never through a direct produce in a request handler.
//
// Trace context travels in the `traceparent` record header (HeaderCarrier).
package kafka

import (
	"context"
	"log/slog"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/plugin/kslog"
)

// NewProducerClient returns a client tuned for throughput: batches linger briefly, are compressed,
// and producers are idempotent with acks=all (franz-go defaults). Keys go through the same murmur2
// partitioner as the Java client, so a rider id lands on the same partition from any language.
// When MaxBufferedRecords is reached Produce blocks: that is the backpressure signal.
func NewProducerClient(brokers []string, clientID string, log *slog.Logger, extra ...kgo.Opt) (*kgo.Client, error) {
	opts := []kgo.Opt{
		kgo.SeedBrokers(brokers...),
		kgo.ClientID(clientID),
		kgo.WithLogger(Logger(log.With("component", "kafka-producer"))),
		kgo.ProducerLinger(5 * time.Millisecond),
		kgo.ProducerBatchCompression(kgo.Lz4Compression(), kgo.SnappyCompression(), kgo.NoCompression()),
		kgo.MaxBufferedRecords(10_000),
		kgo.MaxBufferedBytes(8 << 20), // bounded memory in a 64 MB container
		kgo.RecordDeliveryTimeout(30 * time.Second),
	}
	return kgo.NewClient(append(opts, extra...)...)
}

// Logger adapts slog for franz-go. Its group-lifecycle logs are chatty at info, so they are
// emitted only when LOG_LEVEL=debug; warnings and errors always are.
func Logger(log *slog.Logger) kgo.Logger {
	l := kslog.New(log)
	if log.Enabled(context.Background(), slog.LevelDebug) {
		return l
	}
	return warnLogger{l}
}

type warnLogger struct{ kgo.Logger }

func (warnLogger) Level() kgo.LogLevel { return kgo.LogLevelWarn }

// Ping checks broker connectivity (used by /health/ready).
func Ping(ctx context.Context, cl *kgo.Client) error { return cl.Ping(ctx) }
