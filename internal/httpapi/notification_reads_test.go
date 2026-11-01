package httpapi

import (
	"context"
	v1 "github.com/vioira/viorka/protocol/v1"
	"testing"
)

func TestNotificationReadAPI(t *testing.T) {
	for _, role := range []string{"viewer", "operator", "admin"} {
		t.Run(role, func(t *testing.T) {
			f := setup(t, role)
			enableSettings(t, f)
			node, _ := f.enroll()
			ctx := context.Background()
			if err := f.store.Online(ctx, node, v1.Hello{}); err != nil {
				t.Fatal(err)
			}
			if err := f.store.Offline(ctx, node); err != nil {
				t.Fatal(err)
			}
			items := decodeResponse[NotificationsResponse](t, f.request("GET", "/api/v1/notifications", nil, true), 200)
			if len(items.Items) != 1 || items.Items[0].Read {
				t.Fatalf("initial %+v", items)
			}
			path := "/api/v1/notifications/" + items.Items[0].ID + "/read"
			expectStatus(t, f.request("PUT", path, map[string]any{"read": true}, false), 401)
			for _, body := range []any{map[string]any{}, map[string]any{"read": nil}, map[string]any{"read": "true"}, map[string]any{"read": true, "user_id": "other"}} {
				expectStatus(t, f.request("PUT", path, body, true), 400)
			}
			csrf := f.session.CSRF
			f.session.CSRF = "invalid"
			expectStatus(t, f.request("PUT", path, map[string]any{"read": true}, true), 403)
			f.session.CSRF = csrf
			for _, read := range []bool{true, true, false} {
				expectStatus(t, f.request("PUT", path, map[string]any{"read": read}, true), 204)
				got := decodeResponse[NotificationsResponse](t, f.request("GET", "/api/v1/notifications", nil, true), 200)
				if len(got.Items) != 1 || got.Items[0].Read != read {
					t.Fatalf("read %+v", got)
				}
			}
			expectStatus(t, f.request("PUT", "/api/v1/notifications/missing/read", map[string]any{"read": true}, true), 404)
			f.store.Close()
			expectStatus(t, f.request("PUT", path, map[string]any{"read": true}, true), 503)
		})
	}
}

func TestBatchNotificationReadAPI(t *testing.T) {
	for _, role := range []string{"viewer", "operator", "admin"} {
		t.Run(role, func(t *testing.T) {
			f := setup(t, role)
			enableSettings(t, f)
			ctx := context.Background()
			ids := []string{}
			for i := 0; i < 2; i++ {
				node, _ := f.enroll()
				if err := f.store.Online(ctx, node, v1.Hello{}); err != nil {
					t.Fatal(err)
				}
				if err := f.store.Offline(ctx, node); err != nil {
					t.Fatal(err)
				}
			}
			initial := decodeResponse[NotificationsResponse](t, f.request("GET", "/api/v1/notifications", nil, true), 200)
			for _, item := range initial.Items {
				ids = append(ids, item.ID)
			}
			if len(ids) != 2 {
				t.Fatalf("initial %+v", initial)
			}
			path := "/api/v1/notifications/read"
			body := map[string]any{"ids": ids}
			expectStatus(t, f.request("PUT", path, body, false), 401)
			csrf := f.session.CSRF
			f.session.CSRF = "invalid"
			expectStatus(t, f.request("PUT", path, body, true), 403)
			f.session.CSRF = csrf
			for _, invalid := range []any{map[string]any{}, map[string]any{"ids": []string{}}, map[string]any{"ids": []string{""}}, map[string]any{"ids": []string{ids[0], ids[0]}}, map[string]any{"ids": make([]string, 101)}, map[string]any{"ids": ids, "user_id": "other"}} {
				expectStatus(t, f.request("PUT", path, invalid, true), 400)
			}
			expectStatus(t, f.request("PUT", path, map[string]any{"ids": []string{ids[0], "missing"}}, true), 404)
			unchanged := decodeResponse[NotificationsResponse](t, f.request("GET", "/api/v1/notifications", nil, true), 200)
			for _, item := range unchanged.Items {
				if item.Read {
					t.Fatal("failed batch partially applied")
				}
			}
			for i := 0; i < 2; i++ {
				expectStatus(t, f.request("PUT", path, body, true), 204)
			}
			got := decodeResponse[NotificationsResponse](t, f.request("GET", "/api/v1/notifications", nil, true), 200)
			for _, item := range got.Items {
				if !item.Read {
					t.Fatal("batch did not mark every item")
				}
			}
			f.store.Close()
			expectStatus(t, f.request("PUT", path, body, true), 503)
		})
	}
}
