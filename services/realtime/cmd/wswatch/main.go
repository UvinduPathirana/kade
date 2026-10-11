// Command wswatch connects to realtime's WebSocket, subscribes to channels and prints every frame.
// It sets the identity headers a gateway would, so point it at realtime directly (not a gateway).
//
//	wswatch -user 00000000-0000-7000-8005-000000000005 -roles ops ops:live
//	wswatch -user 00000000-0000-7000-8005-000000000001 -roles customer order:<id> customer:<user id>
//	wswatch -user 00000000-0000-7000-8005-000000000002 -roles merchant_owner,merchant_staff \
//	        -outlet 00000000-0000-7000-8000-000000000001 outlet:00000000-0000-7000-8000-000000000001
//	wswatch -user 00000000-0000-7000-8005-000000000004 -roles rider \
//	        -rider 00000000-0000-7000-8001-000000000101 rider:00000000-0000-7000-8001-000000000101
//
// Run it from the image (`docker exec <realtime container> /app/wswatch ...`), with
// `go run ./cmd/wswatch` in services/realtime, or in a golang container on the kade network
// with -url ws://realtime:8112/ws.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	realtimev1 "github.com/UvinduPathirana/kade/gen/go/kade/realtime/v1"
	"github.com/coder/websocket"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func main() {
	url := flag.String("url", envOr("REALTIME_WS_URL", "ws://localhost:8112/ws"), "realtime WebSocket URL")
	user := flag.String("user", "", "x-user-id (Keycloak sub)")
	roles := flag.String("roles", "", "x-roles, comma-separated")
	outlet := flag.String("outlet", "", "x-outlet-id (merchant staff), comma-separated")
	rider := flag.String("rider", "", "x-rider-id (riders)")
	since := flag.Duration("since", 0, "replay frames from this long ago (e.g. 1m)")
	raw := flag.Bool("raw", false, "print raw JSON frames")
	count := flag.Int("n", 0, "exit after this many messages (0 = run until Ctrl-C)")
	timeout := flag.Duration("timeout", 0, "give up (exit 1) after this long; with -n, the n messages must arrive within it")
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "usage: wswatch [flags] channel...\n\n")
		flag.PrintDefaults()
	}
	flag.Parse()
	if flag.NArg() == 0 {
		flag.Usage()
		os.Exit(2)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	hdr := http.Header{}
	for k, v := range map[string]string{"X-User-Id": *user, "X-Roles": *roles, "X-Outlet-Id": *outlet, "X-Rider-Id": *rider} {
		if v != "" {
			hdr.Set(k, v)
		}
	}
	dctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	conn, resp, err := websocket.Dial(dctx, *url, &websocket.DialOptions{HTTPHeader: hdr})
	cancel()
	if err != nil {
		if resp != nil {
			fmt.Fprintf(os.Stderr, "connect failed: %s (%v)\n", resp.Status, err)
		} else {
			fmt.Fprintln(os.Stderr, "connect failed:", err)
		}
		os.Exit(1)
	}
	defer conn.CloseNow()
	conn.SetReadLimit(1 << 20)

	sub := &realtimev1.Subscribe{Channels: flag.Args()}
	if *since > 0 {
		sub.Since = timestamppb.New(time.Now().Add(-*since))
	}
	b, _ := protojson.Marshal(&realtimev1.ClientFrame{Frame: &realtimev1.ClientFrame_Subscribe{Subscribe: sub}})
	if err := conn.Write(ctx, websocket.MessageText, b); err != nil {
		fmt.Fprintln(os.Stderr, "subscribe failed:", err)
		os.Exit(1)
	}

	// Application-level ping every 20 s (the server also pings at the WebSocket level).
	go func() {
		t := time.NewTicker(20 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-t.C:
				p, _ := protojson.Marshal(&realtimev1.ClientFrame{Frame: &realtimev1.ClientFrame_Ping{Ping: &realtimev1.Ping{Nonce: now.Format("150405")}}})
				_ = conn.Write(ctx, websocket.MessageText, p)
			}
		}
	}()

	messages := 0
	readCtx := ctx
	if *timeout > 0 {
		var c context.CancelFunc
		readCtx, c = context.WithTimeout(ctx, *timeout)
		defer c()
	}
	for {
		_, data, err := conn.Read(readCtx)
		if err != nil {
			if ctx.Err() != nil {
				conn.Close(websocket.StatusNormalClosure, "bye")
				return
			}
			if readCtx.Err() != nil {
				fmt.Fprintln(os.Stderr, "timed out waiting for messages")
				os.Exit(1)
			}
			fmt.Fprintf(os.Stderr, "connection closed: %v (status %d)\n", err, websocket.CloseStatus(err))
			os.Exit(1)
		}
		if *raw {
			fmt.Println(string(data))
		} else {
			printFrame(data)
		}
		var f realtimev1.ServerFrame
		if protojson.Unmarshal(data, &f) == nil && f.GetMessage() != nil {
			messages++
			if *count > 0 && messages >= *count {
				conn.Close(websocket.StatusNormalClosure, "done")
				return
			}
		}
	}
}

func printFrame(data []byte) {
	var f realtimev1.ServerFrame
	if err := protojson.Unmarshal(data, &f); err != nil {
		fmt.Println(string(data))
		return
	}
	now := time.Now().Format("15:04:05.000")
	switch fr := f.Frame.(type) {
	case *realtimev1.ServerFrame_Subscribed:
		fmt.Printf("%s subscribed granted=%v denied=%v\n", now, fr.Subscribed.GetGranted(), fr.Subscribed.GetDenied())
	case *realtimev1.ServerFrame_Pong:
		fmt.Printf("%s pong %s\n", now, fr.Pong.GetNonce())
	case *realtimev1.ServerFrame_Message:
		m := fr.Message
		kind := "?"
		if p := m.ProtoReflect().WhichOneof(m.ProtoReflect().Descriptor().Oneofs().ByName("payload")); p != nil {
			kind = string(p.Name())
		}
		payload, _ := protojson.MarshalOptions{}.Marshal(m)
		var generic map[string]any
		_ = json.Unmarshal(payload, &generic)
		body, _ := json.Marshal(generic[jsonName(kind)])
		fmt.Printf("%s %-28s %-40s %s %s\n", now, m.GetChannel(), m.GetSourceType(), kind, truncate(string(body), 400))
	}
}

// jsonName turns a proto field name into its proto3 JSON (lowerCamel) name.
func jsonName(s string) string {
	parts := strings.Split(s, "_")
	for i := 1; i < len(parts); i++ {
		if parts[i] != "" {
			parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	return strings.Join(parts, "")
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
