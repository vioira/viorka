package httpapi

import (
	"context"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"net/http"
	"strconv"
)

type presetRepository interface {
	ProtocolPresets(context.Context, string, string, int) ([]proxy.Preset, error)
	CreateProtocolPreset(context.Context, string, proxy.PresetConfig) (proxy.Preset, error)
}
type ProtocolPresetsResponse struct {
	Items      []proxy.Preset `json:"items"`
	NextCursor string         `json:"next_cursor"`
}

func (a *api) registerProtocolPresets(routes routeRegistry) {
	routes.handle("GET /api/v1/protocol-presets", "listProtocolPresets", "viewer", 200, nil, ProtocolPresetsResponse{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		limit := 50
		var err error
		for key, values := range r.URL.Query() {
			if (key != "limit" && key != "after") || len(values) != 1 {
				presetProblem(w, proxy.ErrInvalid)
				return
			}
		}
		if v := r.URL.Query().Get("limit"); v != "" {
			limit, err = strconv.Atoi(v)
		}
		after := r.URL.Query().Get("after")
		if err != nil || limit < 1 || limit > 100 || len(after) > 128 {
			presetProblem(w, proxy.ErrInvalid)
			return
		}
		repo, ok := a.Nodes.(presetRepository)
		if !ok {
			presetProblem(w, proxy.ErrUnavailable)
			return
		}
		items, err := repo.ProtocolPresets(r.Context(), s.User.ID, after, limit)
		if err != nil {
			presetProblem(w, err)
			return
		}
		response := ProtocolPresetsResponse{Items: items}
		if len(items) == limit {
			response.NextCursor = items[len(items)-1].ID
		}
		writeJSON(w, 200, response)
	}))
	routes.handle("POST /api/v1/protocol-presets", "createProtocolPreset", "operator", 201, proxy.PresetConfig{}, proxy.Preset{}, a.user("operator", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var c proxy.PresetConfig
		if !decode(w, r, &c) {
			return
		}
		repo, ok := a.Nodes.(presetRepository)
		if !ok {
			presetProblem(w, proxy.ErrUnavailable)
			return
		}
		p, err := repo.CreateProtocolPreset(r.Context(), s.User.ID, c)
		if err != nil {
			presetProblem(w, err)
			return
		}
		writeJSON(w, 201, p)
	}))
}

func presetProblem(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, proxy.ErrInvalid):
		fail(w, 400, "protocol_preset_invalid", "协议预设参数无效，请检查传输与安全组合、地址、端口及 Short ID 格式")
	case errors.Is(err, proxy.ErrConflict):
		fail(w, 409, "protocol_preset_conflict", "协议配置名称已存在，请使用其他名称")
	case errors.Is(err, proxy.ErrForbidden):
		fail(w, 403, "protocol_preset_forbidden", "没有协议预设操作权限，请联系管理员")
	case errors.Is(err, proxy.ErrUnavailable):
		fail(w, 503, "protocol_presets_unavailable", "协议预设服务暂不可用，请稍后重试")
	default:
		problem(w, err)
	}
}
