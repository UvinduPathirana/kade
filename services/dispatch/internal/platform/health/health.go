// Package health serves /health/live and /health/ready.
//
//   - live: the process is up (never checks dependencies, so a DB outage doesn't restart-loop us).
//   - ready: every registered dependency answered within the timeout, and we are not draining.
package health

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

type Check func(ctx context.Context) error

type Checker struct {
	mu       sync.RWMutex
	checks   map[string]Check
	draining atomic.Bool
	timeout  time.Duration
}

func New(timeout time.Duration) *Checker {
	return &Checker{checks: map[string]Check{}, timeout: timeout}
}

// Add registers a readiness check (e.g. "postgres", "kafka", "redis").
func (c *Checker) Add(name string, fn Check) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.checks[name] = fn
}

// SetDraining makes /health/ready fail so load balancers stop sending traffic before shutdown.
func (c *Checker) SetDraining() { c.draining.Store(true) }

type report struct {
	Status string            `json:"status"`
	Checks map[string]string `json:"checks,omitempty"`
}

// Ready runs all checks concurrently.
func (c *Checker) Ready(ctx context.Context) (bool, map[string]string) {
	c.mu.RLock()
	names := make([]string, 0, len(c.checks))
	for n := range c.checks {
		names = append(names, n)
	}
	sort.Strings(names)
	results := make([]string, len(names))
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	var wg sync.WaitGroup
	for i, n := range names {
		wg.Add(1)
		go func(i int, fn Check) {
			defer wg.Done()
			if err := fn(ctx); err != nil {
				results[i] = "error: " + err.Error()
			} else {
				results[i] = "ok"
			}
		}(i, c.checks[n])
	}
	c.mu.RUnlock()
	wg.Wait()
	ok := !c.draining.Load()
	out := make(map[string]string, len(names))
	for i, n := range names {
		out[n] = results[i]
		if results[i] != "ok" {
			ok = false
		}
	}
	if c.draining.Load() {
		out["shutdown"] = "draining"
	}
	return ok, out
}

func (c *Checker) LiveHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, report{Status: "ok"})
	})
}

func (c *Checker) ReadyHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ok, checks := c.Ready(r.Context())
		if !ok {
			writeJSON(w, http.StatusServiceUnavailable, report{Status: "unavailable", Checks: checks})
			return
		}
		writeJSON(w, http.StatusOK, report{Status: "ok", Checks: checks})
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
