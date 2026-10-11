package kafka

import (
	"github.com/twmb/franz-go/pkg/kgo"
)

// Header names written by Debezium's outbox router (see CONVENTIONS.md).
const (
	HeaderEventID     = "id"
	HeaderEventType   = "eventType"
	HeaderTraceparent = "traceparent"

	// Added to records sent to <topic>.dlq.
	HeaderError             = "error"
	HeaderAttempts          = "attempts"
	HeaderOriginalTopic     = "original-topic"
	HeaderOriginalPartition = "original-partition"
	HeaderOriginalOffset    = "original-offset"
	HeaderFailedBy          = "failed-by" // consumer group: <topic>.dlq is shared by every group of <topic>
)

// HeaderCarrier adapts record headers to otel's propagation.TextMapCarrier.
type HeaderCarrier struct{ R *kgo.Record }

func (c HeaderCarrier) Get(key string) string { return Header(c.R, key) }

func (c HeaderCarrier) Set(key, value string) {
	for i, h := range c.R.Headers {
		if h.Key == key {
			c.R.Headers[i].Value = []byte(value)
			return
		}
	}
	c.R.Headers = append(c.R.Headers, kgo.RecordHeader{Key: key, Value: []byte(value)})
}

func (c HeaderCarrier) Keys() []string {
	keys := make([]string, 0, len(c.R.Headers))
	for _, h := range c.R.Headers {
		keys = append(keys, h.Key)
	}
	return keys
}

// Header returns the last value of key ("" if absent).
func Header(r *kgo.Record, key string) string {
	for i := len(r.Headers) - 1; i >= 0; i-- {
		if r.Headers[i].Key == key {
			return string(r.Headers[i].Value)
		}
	}
	return ""
}
