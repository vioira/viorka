package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/scheduler"
	"github.com/vioira/viorka/internal/settings"
	"github.com/vioira/viorka/internal/subscription"
)

type subscriptionRepository interface {
	SubscriptionRules(context.Context, string) ([]subscription.Rule, error)
	SaveSubscriptionRule(context.Context, string, string, subscription.RuleEdit) (subscription.Rule, error)
	DeleteSubscriptionRule(context.Context, string, string, int64) error
	SubscriptionCandidates(context.Context, string, string, int) ([]subscription.ServiceView, string, error)
	Subscriptions(context.Context, string, string, int) ([]subscription.Subscription, string, error)
	Subscription(context.Context, string, string) (subscription.Subscription, error)
	SaveSubscription(context.Context, string, string, subscription.Edit) (subscription.Subscription, string, error)
	RotateSubscription(context.Context, string, string, int64, bool) (string, error)
	DeleteSubscription(context.Context, string, string, int64) error
	SubscriptionAccess(context.Context, string, string) ([]subscription.Access, error)
	ClearSubscriptionAccess(context.Context, string, string) error
	FetchSubscription(context.Context, string, string, string, ...map[string]string) (subscription.Rendered, error)
	SubscriptionRecoveries(context.Context, string, string, int) ([]subscription.RestoreStatus, string, error)
	SubscriptionRecovery(context.Context, string, string) (subscription.RestoreStatus, error)
	AdoptSubscriptionRecovery(context.Context, string, string, string, bool) error
	ConfirmSubscriptionEndpoint(context.Context, string, string, string, string, int, string, int, bool) error
	EngineAction(context.Context, string, string, proxy.Action) (scheduler.Task, error)
}

type SubscriptionRulesResponse struct {
	Items []subscription.Rule `json:"items"`
}
type SubscriptionServicesResponse struct {
	Items      []subscription.ServiceView `json:"items"`
	NextCursor string                     `json:"next_cursor"`
}
type SubscriptionsResponse struct {
	Items      []subscription.Subscription `json:"items"`
	NextCursor string                      `json:"next_cursor"`
}
type SubscriptionAccessResponse struct {
	Items []subscription.Access `json:"items"`
}
type SubscriptionVersionRequest struct {
	Version int64 `json:"version" minimum:"1"`
}
type SubscriptionRuleTestRequest struct {
	UserAgent string   `json:"user_agent" maxLength:"1024"`
	RuleIDs   []string `json:"rule_ids" maxItems:"100"`
}
type SubscriptionRuleTestResponse struct {
	RuleID  string `json:"rule_id"`
	Format  string `json:"format"`
	Matched bool   `json:"matched"`
}
type SubscriptionIssuedResponse struct {
	Subscription subscription.Subscription `json:"subscription"`
	URL          string                    `json:"url"`
	FormatURLs   map[string]string         `json:"format_urls"`
}
type SubscriptionRecoveriesResponse struct {
	Items      []subscription.RestoreStatus `json:"items"`
	NextCursor string                       `json:"next_cursor"`
}
type SubscriptionRecoveryCheckRequest struct {
	IdempotencyKey string `json:"idempotency_key" maxLength:"128"`
}
type SubscriptionRecoveryAdoptRequest struct {
	TaskID  string `json:"task_id" maxLength:"128"`
	Confirm bool   `json:"confirm"`
}
type SubscriptionEndpointRequest struct {
	ServiceID    string `json:"service_id" maxLength:"64"`
	ExpectedHost string `json:"expected_host" maxLength:"253"`
	ExpectedPort int    `json:"expected_port" minimum:"0" maximum:"65535"`
	PublicHost   string `json:"public_host" maxLength:"253"`
	PublicPort   int    `json:"public_port" minimum:"1" maximum:"65535"`
	Confirm      bool   `json:"confirm"`
}

func subscriptionProblem(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, subscription.ErrTemplate):
		fail(w, 503, "subscription_template_failed", "配置模板处理失败，请联系管理员检查模板和脚本。")
	case errors.Is(err, subscription.ErrInvalid):
		fail(w, 400, "subscription_invalid", "订阅或应用规则无效，请检查名称、条件、服务和端口。")
	case errors.Is(err, subscription.ErrConflict):
		fail(w, 409, "subscription_conflict", "订阅内容或引用已变化，请刷新并检查服务状态。")
	case errors.Is(err, subscription.ErrForbidden):
		fail(w, 403, "subscription_forbidden", "没有订阅或所选节点的导出权限。")
	case errors.Is(err, subscription.ErrNotFound):
		fail(w, 404, "subscription_not_found", "订阅不存在或链接已失效。")
	case errors.Is(err, subscription.ErrUnsupported):
		fail(w, 406, "subscription_client_unknown", "未识别客户端，请检查应用规则或指定已启用的格式。")
	case errors.Is(err, subscription.ErrNoServices):
		fail(w, 409, "subscription_no_services", "没有可用于此客户端的服务，请检查发布、权限和兼容状态。")
	default:
		problem(w, err)
	}
}

func subscriptionPage(r *http.Request, maximum int) (int, string, error) {
	limit := maximum
	for key, values := range r.URL.Query() {
		if (key != "limit" && key != "after") || len(values) != 1 {
			return 0, "", subscription.ErrInvalid
		}
	}
	var err error
	if value := r.URL.Query().Get("limit"); value != "" {
		limit, err = strconv.Atoi(value)
	}
	after := r.URL.Query().Get("after")
	if err != nil || limit < 1 || limit > maximum || len(after) > 128 {
		return 0, "", subscription.ErrInvalid
	}
	return limit, after, nil
}

func issueSubscription(origin, token string, item subscription.Subscription, rules []subscription.Rule) SubscriptionIssuedResponse {
	base := strings.TrimRight(origin, "/") + "/api/v1/subscription-links/" + token
	result := SubscriptionIssuedResponse{Subscription: item, URL: base, FormatURLs: map[string]string{}}
	selected := map[string]bool{}
	for _, id := range item.RuleIDs {
		selected[id] = true
	}
	for _, rule := range rules {
		if rule.Enabled && selected[rule.ID] {
			q := url.Values{"format": {rule.Format}}
			result.FormatURLs[rule.Format] = base + "?" + q.Encode()
		}
	}
	return result
}

func (a *api) allowSubscription(w http.ResponseWriter) bool {
	a.subscriptionLimitMu.Lock()
	defer a.subscriptionLimitMu.Unlock()
	if time.Since(a.subscriptionStart) >= time.Minute {
		a.subscriptionStart = time.Now()
		a.subscriptionCount = 0
	}
	a.subscriptionCount++
	if a.subscriptionCount > 600 {
		w.Header().Set("Retry-After", "60")
		fail(w, 429, "subscription_rate_limited", "请求过于频繁，请稍后重试。")
		return false
	}
	return true
}

func (a *api) registerSubscriptions(routes routeRegistry) {
	a.registerSubscriptionTemplates(routes)
	repository := func(w http.ResponseWriter) (subscriptionRepository, bool) {
		repo, ok := a.Nodes.(subscriptionRepository)
		if !ok {
			problem(w, auth.ErrNotFound)
		}
		return repo, ok
	}
	routes.handle("GET /api/v1/subscription-rules", "listSubscriptionRules", "viewer", 200, nil, SubscriptionRulesResponse{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		repo, ok := repository(w)
		if !ok {
			return
		}
		items, err := repo.SubscriptionRules(r.Context(), sess.User.ID)
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		writeJSON(w, 200, SubscriptionRulesResponse{Items: items})
	}))
	routes.handle("POST /api/v1/subscription-rules/test", "testSubscriptionRules", "viewer", 200, SubscriptionRuleTestRequest{}, SubscriptionRuleTestResponse{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		var input SubscriptionRuleTestRequest
		if !decode(w, r, &input) {
			return
		}
		if len(input.UserAgent) > subscription.MaxUserAgent || len(input.RuleIDs) > subscription.MaxRules {
			subscriptionProblem(w, subscription.ErrInvalid)
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		rules, err := repo.SubscriptionRules(r.Context(), sess.User.ID)
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		if len(input.RuleIDs) > 0 {
			selected := map[string]bool{}
			for _, id := range input.RuleIDs {
				if id == "" || selected[id] {
					subscriptionProblem(w, subscription.ErrInvalid)
					return
				}
				selected[id] = true
			}
			filtered := []subscription.Rule{}
			for _, rule := range rules {
				if selected[rule.ID] {
					filtered = append(filtered, rule)
					delete(selected, rule.ID)
				}
			}
			if len(selected) > 0 {
				subscriptionProblem(w, subscription.ErrInvalid)
				return
			}
			rules = filtered
		}
		format, id, err := subscription.SelectFormat(rules, input.UserAgent, "")
		if errors.Is(err, subscription.ErrUnsupported) {
			writeJSON(w, 200, SubscriptionRuleTestResponse{})
			return
		}
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		writeJSON(w, 200, SubscriptionRuleTestResponse{RuleID: id, Format: format, Matched: true})
	}))
	for _, route := range []struct {
		method, path, id string
		status           int
	}{{"POST", "/api/v1/subscription-rules", "createSubscriptionRule", 201}, {"PUT", "/api/v1/subscription-rules/{id}", "updateSubscriptionRule", 200}} {
		routes.handle(route.method+" "+route.path, route.id, "admin", route.status, subscription.RuleEdit{}, subscription.Rule{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
			var input subscription.RuleEdit
			if !decode(w, r, &input) {
				return
			}
			repo, ok := repository(w)
			if !ok {
				return
			}
			item, err := repo.SaveSubscriptionRule(r.Context(), sess.User.ID, r.PathValue("id"), input)
			if err != nil {
				subscriptionProblem(w, err)
				return
			}
			writeJSON(w, route.status, item)
		}))
	}
	routes.handle("DELETE /api/v1/subscription-rules/{id}", "deleteSubscriptionRule", "admin", 204, SubscriptionVersionRequest{}, nil, a.user("admin", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		var input SubscriptionVersionRequest
		if !decode(w, r, &input) {
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		if err := repo.DeleteSubscriptionRule(r.Context(), sess.User.ID, r.PathValue("id"), input.Version); err != nil {
			subscriptionProblem(w, err)
			return
		}
		w.WriteHeader(204)
	}))
	routes.handle("GET /api/v1/subscriptions/candidates", "listSubscriptionCandidates", "operator", 200, nil, SubscriptionServicesResponse{}, a.user("operator", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		limit, after, err := subscriptionPage(r, 20)
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		items, next, err := repo.SubscriptionCandidates(r.Context(), sess.User.ID, after, limit)
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		writeJSON(w, 200, SubscriptionServicesResponse{Items: items, NextCursor: next})
	}))
	routes.handle("GET /api/v1/subscriptions", "listSubscriptions", "viewer", 200, nil, SubscriptionsResponse{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		limit, after, err := subscriptionPage(r, 100)
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		items, next, err := repo.Subscriptions(r.Context(), sess.User.ID, after, limit)
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		writeJSON(w, 200, SubscriptionsResponse{Items: items, NextCursor: next})
	}))
	routes.handle("GET /api/v1/subscriptions/{id}", "getSubscription", "viewer", 200, nil, subscription.Subscription{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		repo, ok := repository(w)
		if !ok {
			return
		}
		item, err := repo.Subscription(r.Context(), sess.User.ID, r.PathValue("id"))
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		writeJSON(w, 200, item)
	}))
	routes.handle("POST /api/v1/subscriptions", "createSubscription", "operator", 201, subscription.Edit{}, SubscriptionIssuedResponse{}, a.user("operator", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		var input subscription.Edit
		if !decode(w, r, &input) {
			return
		}
		if !settings.ValidOrigin(a.Origin) {
			subscriptionProblem(w, subscription.ErrConflict)
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		rules, err := repo.SubscriptionRules(r.Context(), sess.User.ID)
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		item, token, err := repo.SaveSubscription(r.Context(), sess.User.ID, "", input)
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, 201, issueSubscription(a.Origin, token, item, rules))
	}))
	routes.handle("PUT /api/v1/subscriptions/{id}", "updateSubscription", "operator", 200, subscription.Edit{}, subscription.Subscription{}, a.user("operator", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		var input subscription.Edit
		if !decode(w, r, &input) {
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		item, _, err := repo.SaveSubscription(r.Context(), sess.User.ID, r.PathValue("id"), input)
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		writeJSON(w, 200, item)
	}))
	for _, route := range []struct {
		path, id string
		revoke   bool
	}{{"rotate", "rotateSubscription", false}, {"revoke", "revokeSubscription", true}} {
		routes.handle("POST /api/v1/subscriptions/{id}/"+route.path, route.id, "operator", 200, SubscriptionVersionRequest{}, SubscriptionIssuedResponse{}, a.user("operator", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
			var input SubscriptionVersionRequest
			if !decode(w, r, &input) {
				return
			}
			if !route.revoke && !settings.ValidOrigin(a.Origin) {
				subscriptionProblem(w, subscription.ErrConflict)
				return
			}
			repo, ok := repository(w)
			if !ok {
				return
			}
			item, err := repo.Subscription(r.Context(), sess.User.ID, r.PathValue("id"))
			if err != nil {
				subscriptionProblem(w, err)
				return
			}
			rules, err := repo.SubscriptionRules(r.Context(), sess.User.ID)
			if err != nil {
				subscriptionProblem(w, err)
				return
			}
			token, err := repo.RotateSubscription(r.Context(), sess.User.ID, item.ID, input.Version, route.revoke)
			if err != nil {
				subscriptionProblem(w, err)
				return
			}
			item.Version++
			item.Revoked = route.revoke
			w.Header().Set("Cache-Control", "no-store")
			if route.revoke {
				writeJSON(w, 200, SubscriptionIssuedResponse{Subscription: item, FormatURLs: map[string]string{}})
				return
			}
			writeJSON(w, 200, issueSubscription(a.Origin, token, item, rules))
		}))
	}
	routes.handle("DELETE /api/v1/subscriptions/{id}", "deleteSubscription", "operator", 204, SubscriptionVersionRequest{}, nil, a.user("operator", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		var input SubscriptionVersionRequest
		if !decode(w, r, &input) {
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		if err := repo.DeleteSubscription(r.Context(), sess.User.ID, r.PathValue("id"), input.Version); err != nil {
			subscriptionProblem(w, err)
			return
		}
		w.WriteHeader(204)
	}))
	routes.handle("GET /api/v1/subscriptions/{id}/access", "listSubscriptionAccess", "viewer", 200, nil, SubscriptionAccessResponse{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		repo, ok := repository(w)
		if !ok {
			return
		}
		items, err := repo.SubscriptionAccess(r.Context(), sess.User.ID, r.PathValue("id"))
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		writeJSON(w, 200, SubscriptionAccessResponse{Items: items})
	}))
	routes.handle("DELETE /api/v1/subscriptions/{id}/access", "clearSubscriptionAccess", "operator", 204, nil, nil, a.user("operator", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		repo, ok := repository(w)
		if !ok {
			return
		}
		if err := repo.ClearSubscriptionAccess(r.Context(), sess.User.ID, r.PathValue("id")); err != nil {
			subscriptionProblem(w, err)
			return
		}
		w.WriteHeader(204)
	}))
	routes.handle("GET /api/v1/subscription-recovery", "listSubscriptionRecoveries", "operator", 200, nil, SubscriptionRecoveriesResponse{}, a.user("operator", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		limit, after, err := subscriptionPage(r, 20)
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		items, next, err := repo.SubscriptionRecoveries(r.Context(), sess.User.ID, after, limit)
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		writeJSON(w, 200, SubscriptionRecoveriesResponse{Items: items, NextCursor: next})
	}))
	routes.handle("GET /api/v1/subscription-recovery/{id}", "getSubscriptionRecovery", "operator", 200, nil, subscription.RestoreStatus{}, a.user("operator", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		repo, ok := repository(w)
		if !ok {
			return
		}
		item, err := repo.SubscriptionRecovery(r.Context(), sess.User.ID, r.PathValue("id"))
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		writeJSON(w, 200, item)
	}))
	routes.handle("POST /api/v1/subscription-recovery/{id}/check", "checkSubscriptionRecovery", "operator", 202, SubscriptionRecoveryCheckRequest{}, TaskResponse{}, a.user("operator", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		var input SubscriptionRecoveryCheckRequest
		if !decode(w, r, &input) {
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		task, err := repo.EngineAction(r.Context(), sess.User.ID, r.PathValue("id"), proxy.Action{Operation: "engine.inspect", RecoveryCheck: true, IdempotencyKey: input.IdempotencyKey, Confirm: true})
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 202, taskResponse(task))
	}))
	routes.handle("POST /api/v1/subscription-recovery/{id}/adopt", "adoptSubscriptionRecovery", "operator", 204, SubscriptionRecoveryAdoptRequest{}, nil, a.user("operator", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		var input SubscriptionRecoveryAdoptRequest
		if !decode(w, r, &input) {
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		if err := repo.AdoptSubscriptionRecovery(r.Context(), sess.User.ID, r.PathValue("id"), input.TaskID, input.Confirm); err != nil {
			subscriptionProblem(w, err)
			return
		}
		w.WriteHeader(204)
	}))
	routes.handle("POST /api/v1/subscription-recovery/{id}/endpoint", "confirmSubscriptionEndpoint", "operator", 204, SubscriptionEndpointRequest{}, nil, a.user("operator", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		var input SubscriptionEndpointRequest
		if !decode(w, r, &input) {
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		if err := repo.ConfirmSubscriptionEndpoint(r.Context(), sess.User.ID, r.PathValue("id"), input.ServiceID, input.ExpectedHost, input.ExpectedPort, input.PublicHost, input.PublicPort, input.Confirm); err != nil {
			subscriptionProblem(w, err)
			return
		}
		w.WriteHeader(204)
	}))
	routes.handle("GET /api/v1/subscription-links/{token}", "downloadSubscription", "", 200, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if !a.allowSubscription(w) {
			return
		}
		params := map[string]string{}
		for key, values := range r.URL.Query() {
			if len(values) != 1 {
				subscriptionProblem(w, subscription.ErrInvalid)
				return
			}
			if key != "format" {
				params[key] = values[0]
			}
		}
		if err := subscription.ValidateTemplateRequest(subscription.TemplateRequest{UserAgent: r.UserAgent(), Params: params}); err != nil {
			subscriptionProblem(w, err)
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		result, err := repo.FetchSubscription(r.Context(), r.PathValue("token"), r.UserAgent(), r.URL.Query().Get("format"), params)
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		w.Header().Set("Content-Type", result.ContentType)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(200)
		_, _ = w.Write(result.Body)
	})
}
