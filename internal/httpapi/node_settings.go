package httpapi

import (
	"github.com/vioira/viorka/internal/auth"
	v1 "github.com/vioira/viorka/protocol/v1"
	"net/http"
)

type NodeSettingsRequest struct {
	Revision          uint64 `json:"revision" minimum:"1"`
	CollectionSeconds uint64 `json:"collection_seconds" minimum:"0" maximum:"10"`
	ReportSeconds     uint64 `json:"report_seconds" minimum:"30" maximum:"180"`
	ConnectionMode    string `json:"connection_mode" enum:"wss"`
	WSSReportSeconds  uint64 `json:"wss_report_seconds" minimum:"1" maximum:"5"`
}

func (a *api) registerNodeSettings(routes routeRegistry) {
	routes.handle("GET /api/v1/nodes/{id}/settings", "getNodeSettings", "viewer", 200, nil, v1.NodeSettings{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		v, err := a.Nodes.NodeSettings(r.Context(), r.PathValue("id"))
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, v)
	}))
	routes.handle("PUT /api/v1/nodes/{id}/settings", "saveNodeSettings", "admin", 200, NodeSettingsRequest{}, v1.NodeSettings{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var body NodeSettingsRequest
		if !decode(w, r, &body) {
			return
		}
		v := v1.NodeSettings{Revision: body.Revision, CollectionSeconds: body.CollectionSeconds, ReportSeconds: body.ReportSeconds, ConnectionMode: body.ConnectionMode, WssReportSeconds: body.WSSReportSeconds}
		if v.Validate() != nil {
			fail(w, 400, "invalid_settings", "仅支持 WSS；采集间隔须为 0–10 秒，上报间隔须为 30–180 秒，WSS 上报须为 1–5 秒")
			return
		}
		saved, err := a.Nodes.SaveNodeSettings(r.Context(), s.User.ID, r.PathValue("id"), v)
		if err != nil {
			problem(w, err)
			return
		}
		// Reconnect only the management session; proxy processes are unaffected.
		a.Gateway.Revoke(r.PathValue("id"))
		writeJSON(w, 200, saved)
	}))
}
