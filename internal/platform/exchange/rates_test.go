package exchange

import (
	"context"
	"errors"
	"github.com/vioira/viorka/internal/inventory"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type savedQuotes struct{ value inventory.ExchangeRates }

func (s *savedQuotes) StatusRates(context.Context) (inventory.ExchangeRates, error) {
	return s.value, nil
}
func (s *savedQuotes) SaveStatusRates(_ context.Context, v inventory.ExchangeRates) error {
	s.value = v
	return nil
}
func TestDailyCacheAcrossVisitorsAndRestart(t *testing.T) {
	ctx := t.Context()
	c := new(Cache)
	store := new(savedQuotes)
	var calls atomic.Int32
	at := time.Date(2026, 3, 1, 23, 50, 0, 0, time.UTC)
	load := func(_ context.Context, day string) (map[string]inventory.ExchangeQuote, error) {
		calls.Add(1)
		return map[string]inventory.ExchangeQuote{"CNY": {Date: day, Rate: 7}}, nil
	}
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			if _, err := c.rates(ctx, store, at, load); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	c = new(Cache)
	if _, err := c.rates(ctx, store, at, load); err != nil || calls.Load() != 1 {
		t.Fatal(calls.Load(), err)
	}
	failed := func(context.Context, string) (map[string]inventory.ExchangeQuote, error) {
		calls.Add(1)
		return nil, errors.New("offline")
	}
	for range 2 {
		v, err := c.rates(ctx, store, at.Add(time.Hour), failed)
		if err != nil || v.Quotes["CNY"].Date != "2026-03-01" {
			t.Fatal(v, err)
		}
	}
	if calls.Load() != 2 {
		t.Fatal(calls.Load())
	}
}
func TestUSDQuotesRetainIndependentDates(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`[{"date":"2026-03-01","base":"USD","quote":"EUR","rate":0.9},{"date":"2026-03-02","base":"USD","quote":"CNY","rate":7},{"date":"2026-03-02","base":"USD","quote":"JPY","rate":150}]`))
	}))
	defer s.Close()
	q, err := fetch(t.Context(), s.Client(), s.URL, "2026-03-02")
	if err != nil || q["EUR"].Date == q["CNY"].Date || q["JPY"].Rate != 150 {
		t.Fatal(q, err)
	}
}
