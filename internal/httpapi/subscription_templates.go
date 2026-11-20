package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/subscription"
)

type subscriptionTemplateRepository interface {
	SubscriptionTemplates(context.Context, string) ([]subscription.Template, error)
	SaveSubscriptionTemplate(context.Context, string, string, subscription.TemplateEdit) (subscription.Template, error)
	DeleteSubscriptionTemplate(context.Context, string, string, int64) error
	SubscriptionTemplateImpact(context.Context, string, string, string, int) (subscription.TemplateImpactPage, error)
	CompareSubscriptionTemplate(context.Context, string, string, string, subscription.TemplateEdit, subscription.TemplateRequest) (subscription.TemplateComparison, error)
	SubscriptionTemplateHistory(context.Context, string, string) (subscription.TemplateRevisions, error)
	SubscriptionTemplateVersion(context.Context, string, string, int64) (subscription.Template, error)
	RestoreSubscriptionTemplate(context.Context, string, string, subscription.TemplateRestore) (subscription.Template, error)
}
type SubscriptionTemplatesResponse struct {
	Items []subscription.Template `json:"items"`
}
type SubscriptionTemplatePreviewRequest struct {
	Template subscription.TemplateEdit    `json:"template"`
	Request  subscription.TemplateRequest `json:"request"`
}
type SubscriptionTemplateComparisonRequest struct {
	SubscriptionID string                       `json:"subscription_id" maxLength:"128"`
	Template       subscription.TemplateEdit    `json:"template"`
	Request        subscription.TemplateRequest `json:"request"`
}
type SubscriptionTemplatePreviewResponse struct {
	Body        string `json:"body"`
	ContentType string `json:"content_type"`
}

func templateProblem(w http.ResponseWriter, err error) {
	if errors.Is(err, subscription.ErrInvalid) {
		message := "配置模板无效，请检查名称、正文、正则表达式和脚本。"
		if err != subscription.ErrInvalid {
			message = strings.TrimPrefix(err.Error(), subscription.ErrInvalid.Error()+": ")
		}
		fail(w, 400, "subscription_template_invalid", message)
		return
	}
	subscriptionProblem(w, err)
}
func (a *api) registerSubscriptionTemplates(routes routeRegistry) {
	repository := func(w http.ResponseWriter) (subscriptionTemplateRepository, bool) {
		repo, ok := a.Nodes.(subscriptionTemplateRepository)
		if !ok {
			problem(w, auth.ErrNotFound)
		}
		return repo, ok
	}
	routes.handle("GET /api/v1/subscription-templates/{id}/impact", "listTemplateAffectedSubscriptions", "admin", 200, nil, subscription.TemplateImpactPage{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		limit, after, err := subscriptionPage(r, 50)
		if err != nil {
			templateProblem(w, err)
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		out, err := repo.SubscriptionTemplateImpact(r.Context(), sess.User.ID, r.PathValue("id"), after, limit)
		if err != nil {
			templateProblem(w, err)
			return
		}
		writeJSON(w, 200, out)
	}))
	routes.handle("POST /api/v1/subscription-templates/{id}/compare", "compareSubscriptionTemplate", "admin", 200, SubscriptionTemplateComparisonRequest{}, subscription.TemplateComparison{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		var input SubscriptionTemplateComparisonRequest
		if !decodeLimit(w, r, &input, 1<<20) {
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		out, err := repo.CompareSubscriptionTemplate(r.Context(), sess.User.ID, r.PathValue("id"), input.SubscriptionID, input.Template, input.Request)
		if err != nil {
			templateProblem(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, 200, out)
	}))
	routes.handle("GET /api/v1/subscription-templates/{id}/history", "listSubscriptionTemplateHistory", "admin", 200, nil, subscription.TemplateRevisions{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		repo, ok := repository(w)
		if !ok {
			return
		}
		out, err := repo.SubscriptionTemplateHistory(r.Context(), sess.User.ID, r.PathValue("id"))
		if err != nil {
			templateProblem(w, err)
			return
		}
		writeJSON(w, 200, out)
	}))
	routes.handle("GET /api/v1/subscription-templates/{id}/history/{version}", "getSubscriptionTemplateVersion", "admin", 200, nil, subscription.Template{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		version, err := strconv.ParseInt(r.PathValue("version"), 10, 64)
		if err != nil {
			templateProblem(w, subscription.ErrInvalid)
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		out, err := repo.SubscriptionTemplateVersion(r.Context(), sess.User.ID, r.PathValue("id"), version)
		if err != nil {
			templateProblem(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, 200, out)
	}))
	routes.handle("POST /api/v1/subscription-templates/{id}/restore", "restoreSubscriptionTemplateVersion", "admin", 200, subscription.TemplateRestore{}, subscription.Template{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		var input subscription.TemplateRestore
		if !decode(w, r, &input) {
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		out, err := repo.RestoreSubscriptionTemplate(r.Context(), sess.User.ID, r.PathValue("id"), input)
		if err != nil {
			templateProblem(w, err)
			return
		}
		writeJSON(w, 200, out)
	}))

	routes.handle("GET /api/v1/subscription-templates", "listSubscriptionTemplates", "viewer", 200, nil, SubscriptionTemplatesResponse{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		repo, ok := repository(w)
		if !ok {
			return
		}
		items, err := repo.SubscriptionTemplates(r.Context(), sess.User.ID)
		if err != nil {
			templateProblem(w, err)
			return
		}
		writeJSON(w, 200, SubscriptionTemplatesResponse{Items: items})
	}))
	for _, route := range []struct {
		method, path, id string
		status           int
	}{{"POST", "/api/v1/subscription-templates", "createSubscriptionTemplate", 201}, {"PUT", "/api/v1/subscription-templates/{id}", "updateSubscriptionTemplate", 200}} {
		routes.handle(route.method+" "+route.path, route.id, "admin", route.status, subscription.TemplateEdit{}, subscription.Template{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
			var input subscription.TemplateEdit
			if !decodeLimit(w, r, &input, 1<<20) {
				return
			}
			repo, ok := repository(w)
			if !ok {
				return
			}
			item, err := repo.SaveSubscriptionTemplate(r.Context(), sess.User.ID, r.PathValue("id"), input)
			if err != nil {
				templateProblem(w, err)
				return
			}
			writeJSON(w, route.status, item)
		}))
	}
	routes.handle("DELETE /api/v1/subscription-templates/{id}", "deleteSubscriptionTemplate", "admin", 204, SubscriptionVersionRequest{}, nil, a.user("admin", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		var input SubscriptionVersionRequest
		if !decodeLimit(w, r, &input, 1<<20) {
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		if err := repo.DeleteSubscriptionTemplate(r.Context(), sess.User.ID, r.PathValue("id"), input.Version); err != nil {
			templateProblem(w, err)
			return
		}
		w.WriteHeader(204)
	}))
	routes.handle("POST /api/v1/subscription-templates/preview", "previewSubscriptionTemplate", "admin", 200, SubscriptionTemplatePreviewRequest{}, SubscriptionTemplatePreviewResponse{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, sess auth.Session) {
		var input SubscriptionTemplatePreviewRequest
		if !decodeLimit(w, r, &input, 1<<20) {
			return
		}
		result, err := subscription.PreviewTemplate(r.Context(), input.Template, input.Request)
		if err != nil {
			templateProblem(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, 200, SubscriptionTemplatePreviewResponse{Body: string(result.Body), ContentType: result.ContentType})
	}))
}
