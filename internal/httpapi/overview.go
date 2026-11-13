package httpapi

import (
	"context"
	"math/big"
	"net/http"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/proxy"
)

type overviewRepository interface {
	Overview(context.Context, string) (inventory.Overview, error)
	OverviewTraffic(context.Context, int, *time.Location, time.Time) (inventory.OverviewTraffic, error)
}

func (a *api) registerOverview(routes routeRegistry) {
	routes.handle("GET /api/v1/overview", "overview", "viewer", 200, nil, inventory.Overview{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if len(r.URL.Query()) != 0 {
			problem(w, auth.ErrInvalid)
			return
		}
		repo, ok := a.Nodes.(overviewRepository)
		if !ok {
			problem(w, proxy.ErrUnavailable)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		result, err := repo.Overview(ctx, s.User.ID)
		if err == nil && a.Gateway != nil {
			err = a.overviewQuota(ctx, &result)
		}
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, result)
	}))
	routes.handle("GET /api/v1/overview/traffic", "overviewTraffic", "viewer", 200, nil, inventory.OverviewTraffic{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, _ auth.Session) {
		q := r.URL.Query()
		for k, v := range q {
			if (k != "range" && k != "timezone") || len(v) != 1 {
				problem(w, auth.ErrInvalid)
				return
			}
		}
		days := map[string]int{"day": 1, "week": 7, "month": 30}[q.Get("range")]
		if days == 0 {
			problem(w, auth.ErrInvalid)
			return
		}
		zone := q.Get("timezone")
		if zone == "" {
			zone = "UTC"
		}
		loc, err := time.LoadLocation(zone)
		if err != nil || zone == "Local" {
			problem(w, auth.ErrInvalid)
			return
		}
		repo, ok := a.Nodes.(overviewRepository)
		if !ok {
			problem(w, proxy.ErrUnavailable)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		result, err := repo.OverviewTraffic(ctx, days, loc, time.Now())
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, result)
	}))
}
func (a *api) overviewQuota(ctx context.Context, out *inventory.Overview) error {
	after := ""
	for len(out.Attention) < 10 {
		nodes, err := a.Nodes.Nodes(ctx, 100, after)
		if err != nil {
			return err
		}
		for _, n := range nodes {
			if err := ctx.Err(); err != nil {
				return err
			}
			live, err := a.Gateway.ReadMetrics(n.ID, monitoring.Cursor{}, true)
			if err != nil {
				return err
			}
			t := live.Telemetry
			if t == nil || t.FastStale || t.Settings == nil || t.Settings.Traffic == nil || t.Fast == nil || t.Fast.Traffic == nil {
				continue
			}
			traffic := t.Fast.Traffic
			settings := t.Settings.Traffic
			if len(traffic.Quality) > 0 || traffic.RXBytes == nil || traffic.TXBytes == nil || (!traffic.PeriodEnd.IsZero() && !traffic.PeriodEnd.After(time.Now())) {
				continue
			}
			quota, ok := new(big.Int).SetString(settings.QuotaBytes, 10)
			if !ok || quota.Sign() == 0 {
				continue
			}
			rx, _ := new(big.Int).SetString(*traffic.RXBytes, 10)
			tx, _ := new(big.Int).SetString(*traffic.TXBytes, 10)
			used := new(big.Int)
			if settings.BillingMode != "outbound" {
				used.Add(used, rx)
			}
			if settings.BillingMode != "inbound" {
				used.Add(used, tx)
			}
			if new(big.Int).Mul(used, big.NewInt(10)).Cmp(new(big.Int).Mul(quota, big.NewInt(9))) >= 0 {
				title, tone := "流量接近限额", "warning"
				if used.Cmp(quota) >= 0 {
					title, tone = "流量已达限额", "danger"
				}
				out.Attention = append(out.Attention, inventory.OverviewAttention{NodeID: n.ID, Title: n.Name + " " + title, Detail: "当前计费周期用量已达到额度的 90% 以上", Tone: tone})
				if len(out.Attention) == 10 {
					return nil
				}
			}
		}
		if len(nodes) < 100 {
			return nil
		}
		after = nodes[len(nodes)-1].ID
	}
	return nil
}
