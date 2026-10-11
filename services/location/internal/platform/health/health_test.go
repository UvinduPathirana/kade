package health

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestReady(t *testing.T) {
	c := New(50 * time.Millisecond)
	c.Add("postgres", func(context.Context) error { return nil })
	rec := httptest.NewRecorder()
	c.ReadyHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"postgres":"ok"`) {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}

	c.Add("kafka", func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }) // hangs → times out
	c.Add("redis", func(context.Context) error { return errors.New("connection refused") })
	rec = httptest.NewRecorder()
	c.ReadyHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "connection refused") || !strings.Contains(rec.Body.String(), "deadline") {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

func TestDrainingAndLive(t *testing.T) {
	c := New(time.Second)
	c.SetDraining()
	if ok, checks := c.Ready(context.Background()); ok || checks["shutdown"] != "draining" {
		t.Fatalf("ok=%v checks=%v", ok, checks)
	}
	rec := httptest.NewRecorder()
	c.LiveHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health/live", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("live = %d while draining", rec.Code)
	}
}
