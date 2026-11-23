package httpapi

import (
	"github.com/vioira/viorka/internal/inventory"
	"testing"
)

func TestNodeBillingAPI(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	path := "/api/v1/nodes/" + node + "/billing"
	put := func(v map[string]any, status int) {
		t.Helper()
		expectStatus(t, f.request("PUT", path, v, true), status)
	}
	expectStatus(t, f.request("PUT", path, nil, false), 401)
	for _, role := range []string{"viewer", "operator"} {
		g := setup(t, role)
		readable, _ := g.enroll()
		price, months := "1.25", 1
		_, err := g.store.SaveNodeBilling(t.Context(), "user", readable, inventory.BillingUpdate{ExpectedRevision: 1, Price: &price, Currency: "EUR", PeriodMonths: &months})
		if err != nil {
			t.Fatal(err)
		}
		view := decodeResponse[inventory.Node](t, g.request("GET", "/api/v1/nodes/"+readable, nil, true), 200)
		if view.Billing.Price == nil || *view.Billing.Price != price {
			t.Fatal(view)
		}
		expectStatus(t, g.request("PUT", path, map[string]any{"expected_revision": 1}, true), 403)
	}
	for _, bad := range []map[string]any{
		{"price": "0"}, {"currency": "USD"}, {"period_months": 1},
		{"price": "-1", "currency": "USD", "period_months": 1}, {"price": "0.1", "currency": "JPY", "period_months": 1},
		{"price": "3.000", "currency": "EUR", "period_months": 1}, {"price": "3", "currency": "AAA", "period_months": 1},
		{"price": "1", "currency": "CNY", "period_months": 12}, {"price": 0.1, "currency": "EUR", "period_months": 1},
		{"expires_at": "2026-10-01T02:03:04Z"}, {"expires_at": "2026-10-01T02:03"}, {"price": "92233720368547758.08", "currency": "USD", "period_months": 1},
	} {
		bad["expected_revision"] = 1
		put(bad, 400)
	}
	rev := 1
	for _, months := range []int{1, 3, 6, 24, 36, 48, 60} {
		put(map[string]any{"expected_revision": rev, "price": "0", "currency": "JPY", "period_months": months}, 200)
		rev++
	}
	put(map[string]any{"expected_revision": 1}, 409)
	read := func() inventory.Billing {
		return decodeResponse[inventory.Node](t, f.request("GET", "/api/v1/nodes/"+node, nil, true), 200).Billing
	}
	b := read()
	if b.Price == nil || *b.Price != "0" || *b.PeriodMonths != 60 {
		t.Fatal(b)
	}
	put(map[string]any{"expected_revision": rev, "expires_at": "2020-02-29T06:00:00+08:00"}, 200)
	b = read()
	if b.Price != nil || b.PeriodMonths != nil || b.Currency != "" || b.ExpiresAt == nil || *b.ExpiresAt != "2020-02-28T22:00:00Z" {
		t.Fatal(b)
	}
	put(map[string]any{"expected_revision": rev + 1}, 200)
	if b = read(); b.ExpiresAt != nil {
		t.Fatal(b)
	}
}
