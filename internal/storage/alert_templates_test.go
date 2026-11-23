package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/vioira/viorka/internal/alerts"
	"github.com/vioira/viorka/internal/auth"
)

func TestUpgradeSavedAlertTemplates(t *testing.T) {
	const body = "{node}，{metric}，{basis} {value}，阈值 {threshold}。\n{time}"
	legacy := alerts.Template{ID: "default", Name: "默认通知",
		Trigger:  alerts.Message{Title: "告警：{rule}", Body: body},
		Repeat:   alerts.Message{Title: "持续告警：{rule}", Body: body},
		Recovery: alerts.Message{Title: "已恢复：{rule}", Body: "{node}，{metric}已恢复，持续 {duration}。\n{time}"},
	}
	for _, scenario := range []string{"factory", "edited", "rebound", "collision", "full"} {
		t.Run(scenario, func(t *testing.T) {
			ctx := context.Background()
			s := testStore(t)
			cfg := alerts.Defaults()
			cfg.Rules[0].Template = "default"
			extra := cfg.Rules[0]
			extra.ID = "second-rule"
			cfg.Rules = append(cfg.Rules, extra)
			copy := legacy
			copy.ID = "copy"
			cfg.Templates = []alerts.Template{legacy, copy}
			wantBinding := alerts.OfflineTemplate
			wantDefault := alerts.Defaults().Templates[0]
			switch scenario {
			case "edited":
				cfg.Templates[0].Repeat.Body += " 请联系值班人员。"
				wantDefault = cfg.Templates[0]
				wantBinding = "default"
			case "rebound":
				cfg.Rules[0].Template = "copy"
				wantBinding = "copy"
			case "collision":
				cfg.Templates[1].ID = alerts.OfflineTemplate
				wantBinding = "default"
			case "full":
				for len(cfg.Templates) < 32 {
					next := copy
					next.ID = fmt.Sprintf("copy-%d", len(cfg.Templates))
					cfg.Templates = append(cfg.Templates, next)
				}
				wantBinding = "default"
			}
			raw, err := json.Marshal(cfg)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = s.db.Exec("UPDATE alert_config SET config_json=?,revision=7", string(raw)); err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if err = s.InitSettings(ctx, "https://panel.test"); err != nil {
					t.Fatal(err)
				}
				v, err := s.AlertSettings(ctx)
				if err != nil {
					t.Fatal(err)
				}
				got := v.Config
				if err = got.Validate(); err != nil || got.Revision != 8 || got.Rules[0].Template != wantBinding || got.Rules[1].Template != "default" || got.Templates[0] != wantDefault || got.Templates[1] != cfg.Templates[1] {
					t.Fatalf("unexpected upgraded settings: %+v, %v", got, err)
				}
				wantCount := len(cfg.Templates)
				if scenario != "full" && scenario != "collision" {
					wantCount++
				}
				if len(got.Templates) != wantCount {
					t.Fatalf("got %d templates, want %d", len(got.Templates), wantCount)
				}
			}
			cfg.Revision = 7
			if err := s.SaveAlertSettings(ctx, "admin", alerts.Edit{Config: cfg}); !errors.Is(err, auth.ErrConflict) {
				t.Fatalf("stale editor save: %v", err)
			}
		})
	}
}
