package kafka

import (
	"context"
	"fmt"
	"strings"

	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/desc/protoprint"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sr"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// StreamProducer produces T to one topic in the Confluent wire format:
//
//	0x00 | schema id (4 bytes, big endian) | message-index varints | protobuf bytes
//
// The schema is registered once at construction under the TopicNameStrategy subject
// "<topic>-value", with imported kade .proto files registered as references (subject = import
// path), so Java/TS consumers with the Confluent deserializer read it unchanged.
type StreamProducer[T proto.Message] struct {
	cl       *kgo.Client
	topic    string
	schemaID int
	prefix   []byte // magic byte + id + message index, identical for every record
	tracer   trace.Tracer
}

func NewStreamProducer[T proto.Message](ctx context.Context, cl *kgo.Client, reg *sr.Client, topic string) (*StreamProducer[T], error) {
	var zero T
	md := zero.ProtoReflect().Descriptor()
	id, err := RegisterProto(ctx, reg, topic+"-value", md.ParentFile())
	if err != nil {
		return nil, fmt.Errorf("register schema for %s: %w", topic, err)
	}
	var h sr.ConfluentHeader
	prefix, _ := h.AppendEncode(nil, id, MessageIndex(md))
	return &StreamProducer[T]{cl: cl, topic: topic, schemaID: id, prefix: prefix, tracer: otel.Tracer("kade/kafka")}, nil
}

func (p *StreamProducer[T]) SchemaID() int { return p.schemaID }
func (p *StreamProducer[T]) Topic() string { return p.topic }

// Encode returns the Confluent-framed bytes for msg.
func (p *StreamProducer[T]) Encode(msg T) ([]byte, error) {
	return proto.MarshalOptions{}.MarshalAppend(append([]byte(nil), p.prefix...), msg)
}

// Produce sends asynchronously; onDone (may be nil) gets the result. key picks the partition (use
// the entity id, e.g. rider id, to keep its stream ordered). Blocks when the client buffer is full,
// so callers feel backpressure instead of growing memory without bound.
func (p *StreamProducer[T]) Produce(ctx context.Context, key string, msg T, onDone func(*kgo.Record, error)) {
	value, err := p.Encode(msg)
	if err != nil {
		if onDone != nil {
			onDone(nil, err)
		}
		return
	}
	rec := &kgo.Record{Topic: p.topic, Key: []byte(key), Value: value}
	ctx, span := p.tracer.Start(ctx, p.topic+" publish", trace.WithSpanKind(trace.SpanKindProducer),
		trace.WithAttributes(attribute.String("messaging.system", "kafka"), attribute.String("messaging.destination.name", p.topic)))
	otel.GetTextMapPropagator().Inject(ctx, HeaderCarrier{rec})
	// The record must outlive a request-scoped ctx; cancellation is not propagated to the produce.
	p.cl.Produce(context.WithoutCancel(ctx), rec, func(r *kgo.Record, err error) {
		if err != nil {
			span.SetStatus(codes.Error, err.Error())
		}
		span.End()
		if onDone != nil {
			onDone(r, err)
		}
	})
}

// DecodeConfluent strips the Confluent header from b and unmarshals the payload into msg.
// Consumers of registry-encoded streams (dispatch reading kade.rider.locations) use it.
func DecodeConfluent(b []byte, msg proto.Message) (schemaID int, err error) {
	var h sr.ConfluentHeader
	id, rest, err := h.DecodeID(b)
	if err != nil {
		return 0, err
	}
	if _, rest, err = h.DecodeIndex(rest, 8); err != nil {
		return id, err
	}
	return id, proto.Unmarshal(rest, msg)
}

// MessageIndex is the path of md inside its file (top-level index, then nested indexes).
func MessageIndex(md protoreflect.MessageDescriptor) []int {
	var idx []int
	var d protoreflect.Descriptor = md
	for {
		idx = append([]int{d.Index()}, idx...)
		parent, ok := d.Parent().(protoreflect.MessageDescriptor)
		if !ok {
			return idx
		}
		d = parent
	}
}

// RegisterProto registers fd (and, first, its non-well-known imports) and returns the schema id.
// Registration is idempotent: the registry returns the existing id for an identical schema.
func RegisterProto(ctx context.Context, reg *sr.Client, subject string, fd protoreflect.FileDescriptor) (int, error) {
	refs, err := registerImports(ctx, reg, fd, map[string]sr.SchemaReference{})
	if err != nil {
		return 0, err
	}
	text, err := ProtoText(fd)
	if err != nil {
		return 0, err
	}
	ss, err := reg.CreateSchema(ctx, subject, sr.Schema{Schema: text, Type: sr.TypeProtobuf, References: refs})
	if err != nil {
		return 0, err
	}
	return ss.ID, nil
}

func registerImports(ctx context.Context, reg *sr.Client, fd protoreflect.FileDescriptor, seen map[string]sr.SchemaReference) ([]sr.SchemaReference, error) {
	var refs []sr.SchemaReference
	imports := fd.Imports()
	for i := 0; i < imports.Len(); i++ {
		dep := imports.Get(i).FileDescriptor
		path := dep.Path()
		if strings.HasPrefix(path, "google/protobuf/") {
			continue // well-known types are built into the Confluent registry
		}
		if ref, ok := seen[path]; ok {
			refs = append(refs, ref)
			continue
		}
		depRefs, err := registerImports(ctx, reg, dep, seen)
		if err != nil {
			return nil, err
		}
		text, err := ProtoText(dep)
		if err != nil {
			return nil, err
		}
		ss, err := reg.CreateSchema(ctx, path, sr.Schema{Schema: text, Type: sr.TypeProtobuf, References: depRefs})
		if err != nil {
			return nil, fmt.Errorf("register %s: %w", path, err)
		}
		ref := sr.SchemaReference{Name: path, Subject: path, Version: ss.Version}
		seen[path] = ref
		refs = append(refs, ref)
	}
	return refs, nil
}

// ProtoText renders a compiled file descriptor back to .proto source (message order preserved,
// so message indexes stay valid).
func ProtoText(fd protoreflect.FileDescriptor) (string, error) {
	wrapped, err := desc.WrapFile(fd)
	if err != nil {
		return "", err
	}
	var p protoprint.Printer
	return p.PrintProtoToString(wrapped)
}
