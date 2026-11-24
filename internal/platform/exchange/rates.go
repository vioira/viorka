// Package exchange caches the daily USD reference quotes used to estimate rental value.
package exchange

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/vioira/viorka/internal/inventory"
	"io"
	"log/slog"
	"math"
	"net/http"
	"sync"
	"time"
)

type Repository interface {
	StatusRates(context.Context) (inventory.ExchangeRates, error)
	SaveStatusRates(context.Context, inventory.ExchangeRates) error
}
type Cache struct {
	mu         sync.Mutex
	retryAfter time.Time
}

const endpoint = "https://api.frankfurter.dev/v2/rates?base=USD"

func (c *Cache) Rates(ctx context.Context, repo Repository, now time.Time) (inventory.ExchangeRates, error) {
	return c.rates(ctx, repo, now, func(ctx context.Context, day string) (map[string]inventory.ExchangeQuote, error) {
		return fetch(ctx, http.DefaultClient, endpoint, day)
	})
}
func (c *Cache) rates(ctx context.Context, repo Repository, now time.Time, load func(context.Context, string) (map[string]inventory.ExchangeQuote, error)) (inventory.ExchangeRates, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	saved, err := repo.StatusRates(ctx)
	if err != nil {
		return saved, err
	}
	day := now.UTC().Format(time.DateOnly)
	if saved.Day == day || now.Before(c.retryAfter) {
		return saved, nil
	}
	requestCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	quotes, err := load(requestCtx, day)
	if err != nil {
		if ctx.Err() != nil {
			return saved, ctx.Err()
		}
		c.retryAfter = now.Add(15 * time.Minute)
		slog.Warn("status exchange rates unavailable", "error", err)
		return saved, nil
	}
	fresh := inventory.ExchangeRates{Day: day, Quotes: quotes}
	return fresh, repo.SaveStatusRates(ctx, fresh)
}
func fetch(ctx context.Context, client *http.Client, url, day string) (map[string]inventory.ExchangeQuote, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("quote service HTTP %d", resp.StatusCode)
	}
	var records []struct {
		Base, Quote, Date string
		Rate              float64
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > 1<<20 {
		return nil, fmt.Errorf("quote response too large")
	}
	if err = json.Unmarshal(raw, &records); err != nil {
		return nil, err
	}
	quotes := map[string]inventory.ExchangeQuote{}
	for _, r := range records {
		if r.Quote != "CNY" && r.Quote != "JPY" && r.Quote != "EUR" {
			continue
		}
		_, dateErr := time.Parse(time.DateOnly, r.Date)
		if r.Base != "USD" || dateErr != nil || r.Date > day || r.Rate <= 0 || math.IsInf(r.Rate, 0) {
			return nil, fmt.Errorf("invalid %s exchange quote", r.Quote)
		}
		quotes[r.Quote] = inventory.ExchangeQuote{Rate: r.Rate, Date: r.Date}
	}
	if len(quotes) != 3 {
		return nil, fmt.Errorf("missing exchange quotes")
	}
	return quotes, nil
}
