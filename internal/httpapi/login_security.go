package httpapi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
)

type PasskeyBeginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}
type PasskeyFinishRequest struct {
	Name       string          `json:"name"`
	Credential json.RawMessage `json:"credential"`
}
type PasskeyListResponse struct {
	Items []auth.Passkey `json:"items"`
}
type SessionHistoryResponse struct {
	Items      []auth.SessionRecord `json:"items"`
	NextCursor string               `json:"next_cursor"`
}

func (a *api) requestMetadata(r *http.Request, method string) auth.LoginMetadata {
	host, _, e := net.SplitHostPort(r.RemoteAddr)
	if e != nil {
		host = r.RemoteAddr
	}
	ip, e := netip.ParseAddr(host)
	if e != nil {
		host = ""
	} else {
		host = ip.Unmap().String()
	}
	if e == nil && a.trustedProxy(ip.Unmap()) {
		forwarded := r.Header.Values("X-Forwarded-For")
		if len(forwarded) == 1 && len(forwarded[0]) <= 2048 {
			hops := strings.Split(forwarded[0], ",")
			current := ip.Unmap()
			valid := len(hops) <= 32
			for i := len(hops) - 1; i >= 0 && a.trustedProxy(current) && valid; i-- {
				next, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
				if err != nil {
					valid = false
					break
				}
				current = next.Unmap()
			}
			if valid {
				host = current.String()
			}
		}
	}
	ua := r.UserAgent()
	if len(ua) > 2048 {
		ua = ua[:2048]
	}
	source := r.Header.Get("Origin")
	if len(source) > 512 {
		source = source[:512]
	}
	return auth.LoginMetadata{IP: host, UserAgent: ua, Source: source, Method: method}
}
func (a *api) registerLoginSecurity(routes routeRegistry) {
	routes.handle("GET /api/v1/auth/sessions", "listSessions", "viewer", 200, nil, SessionHistoryResponse{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		limit := 20
		q := r.URL.Query()
		for k, v := range q {
			if (k != "limit" && k != "after") || len(v) != 1 {
				problem(w, auth.ErrInvalid)
				return
			}
		}
		if q.Has("limit") {
			n, e := strconv.Atoi(q.Get("limit"))
			if e != nil || n < 1 || n > 100 {
				problem(w, auth.ErrInvalid)
				return
			}
			limit = n
		}
		after := q.Get("after")
		if len(after) > 64 {
			problem(w, auth.ErrInvalid)
			return
		}
		c, _ := r.Cookie("viorka_session")
		items, e := a.Auth.SessionHistory(r.Context(), s.User.ID, c.Value, after, limit)
		if e != nil {
			problem(w, e)
			return
		}
		for i := range items {
			for j := range items[i].IPs {
				items[i].IPs[j].Location = a.ipLocation(items[i].IPs[j].IP)
			}
			items[i].FirstLocation = a.ipLocation(items[i].FirstIP)
			items[i].LatestLocation = a.ipLocation(items[i].LatestIP)
		}
		out := SessionHistoryResponse{Items: items}
		if len(items) == limit {
			out.NextCursor = items[len(items)-1].ID
		}
		writeJSON(w, 200, out)
	}))
	routes.handle("DELETE /api/v1/auth/sessions/{id}", "revokeSession", "viewer", 204, nil, nil, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if e := a.Auth.RevokeSession(r.Context(), s.User.ID, r.PathValue("id")); e != nil {
			problem(w, e)
			return
		}
		w.WriteHeader(204)
	}))
	routes.handle("GET /api/v1/auth/passkeys", "listPasskeys", "viewer", 200, nil, PasskeyListResponse{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		v, e := a.Auth.Passkeys(r.Context(), s.User.ID)
		if e != nil {
			problem(w, e)
			return
		}
		writeJSON(w, 200, PasskeyListResponse{v})
	}))
	routes.handle("DELETE /api/v1/auth/passkeys/{id}", "removePasskey", "viewer", 204, nil, nil, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if e := a.Auth.RemovePasskey(r.Context(), s.User.ID, r.PathValue("id")); e != nil {
			problem(w, e)
			return
		}
		w.WriteHeader(204)
	}))
	routes.handle("POST /api/v1/auth/passkeys/register/begin", "beginPasskeyRegistration", "viewer", 200, PasskeyBeginRequest{}, protocol.CredentialCreation{}, a.user("viewer", a.beginPasskeyRegistration))
	routes.handle("POST /api/v1/auth/passkeys/register/finish", "finishPasskeyRegistration", "viewer", 204, PasskeyFinishRequest{}, nil, a.user("viewer", a.finishPasskeyRegistration))
	routes.handle("POST /api/v1/auth/passkeys/login/begin", "beginPasskeyLogin", "", 200, PasskeyBeginRequest{}, protocol.CredentialAssertion{}, a.beginPasskeyLogin)
	routes.handle("POST /api/v1/auth/passkeys/login/finish", "finishPasskeyLogin", "", 200, PasskeyFinishRequest{}, auth.Session{}, a.finishPasskeyLogin)
}
func (a *api) ceremonyCookie(w http.ResponseWriter, token, kind string) {
	age := 300
	if token == "" {
		age = -1
	}
	http.SetCookie(w, &http.Cookie{Name: "viorka_webauthn_" + kind, Value: token, Path: "/api/v1/auth/passkeys/" + kind, HttpOnly: true, Secure: strings.HasPrefix(a.Origin, "https://"), SameSite: http.SameSiteStrictMode, MaxAge: age})
}
func (a *api) beginPasskeyRegistration(w http.ResponseWriter, r *http.Request, s auth.Session) {
	if !a.allow(w) {
		return
	}
	var v PasskeyBeginRequest
	if !decode(w, r, &v) {
		return
	}
	if _, e := a.Auth.VerifyPassword(r.Context(), s.User.Username, v.Password); e != nil {
		problem(w, e)
		return
	}
	web, e := auth.NewWebAuthn(a.Origin)
	if e != nil {
		fail(w, 503, "passkey_unavailable", "通行密钥需要 HTTPS 或 localhost，请检查公开地址配置")
		return
	}
	u, e := a.Auth.WebUser(r.Context(), s.User.ID)
	if e != nil {
		problem(w, e)
		return
	}
	if len(u.Keys) >= 20 {
		problem(w, auth.ErrConflict)
		return
	}
	excluded := []protocol.CredentialDescriptor{}
	for _, key := range u.Keys {
		excluded = append(excluded, key.Descriptor())
	}
	options, data, e := web.BeginRegistration(u, func(o *protocol.PublicKeyCredentialCreationOptions) { o.CredentialExcludeList = excluded })
	if e != nil {
		problem(w, e)
		return
	}
	c, _ := r.Cookie("viorka_session")
	token, e := a.Auth.SaveCeremony(r.Context(), u.ID, "register", auth.Hash(c.Value), data)
	if e != nil {
		problem(w, e)
		return
	}
	a.ceremonyCookie(w, token, "register")
	writeJSON(w, 200, options)
}
func (a *api) finishPasskeyRegistration(w http.ResponseWriter, r *http.Request, s auth.Session) {
	if !a.allow(w) {
		return
	}
	var v PasskeyFinishRequest
	if !decode(w, r, &v) {
		return
	}
	v.Name = strings.TrimSpace(v.Name)
	if len(v.Name) < 1 || len(v.Name) > 64 {
		problem(w, auth.ErrInvalid)
		return
	}
	c, e := r.Cookie("viorka_webauthn_register")
	if e != nil {
		problem(w, auth.ErrUnauthorized)
		return
	}
	session, _ := r.Cookie("viorka_session")
	u, data, e := a.Auth.TakeCeremony(r.Context(), c.Value, "register", auth.Hash(session.Value))
	a.ceremonyCookie(w, "", "register")
	if e != nil {
		problem(w, e)
		return
	}
	if u.ID != s.User.ID {
		problem(w, auth.ErrUnauthorized)
		return
	}
	web, e := auth.NewWebAuthn(a.Origin)
	if e != nil {
		problem(w, e)
		return
	}
	parsed, e := protocol.ParseCredentialCreationResponseBody(bytes.NewReader(v.Credential))
	if e != nil {
		problem(w, auth.ErrInvalid)
		return
	}
	key, e := web.CreateCredential(u, data, parsed)
	if e != nil {
		problem(w, auth.ErrUnauthorized)
		return
	}
	if e = a.Auth.SavePasskey(r.Context(), u.User, v.Name, *key); e != nil {
		problem(w, e)
		return
	}
	w.WriteHeader(204)
}
func (a *api) beginPasskeyLogin(w http.ResponseWriter, r *http.Request) {
	if !a.allowedOrigin(r) {
		fail(w, 403, "origin_rejected", "请求来源不受信任")
		return
	}
	if !a.allow(w) {
		return
	}
	var v PasskeyBeginRequest
	if !decode(w, r, &v) {
		return
	}
	if len(v.Username) < 1 || len(v.Username) > 64 {
		problem(w, auth.ErrInvalid)
		return
	}
	web, e := auth.NewWebAuthn(a.Origin)
	if e != nil {
		fail(w, 503, "passkey_unavailable", "通行密钥需要 HTTPS 或 localhost，请检查公开地址配置")
		return
	}
	u, e := a.Auth.UserForPasskey(r.Context(), v.Username)
	if e != nil {
		problem(w, e)
		return
	}
	if len(u.Keys) == 0 {
		problem(w, auth.ErrUnauthorized)
		return
	}
	options, data, e := web.BeginLogin(u)
	if e != nil {
		problem(w, e)
		return
	}
	token, e := a.Auth.SaveCeremony(r.Context(), u.ID, "login", "", data)
	if e != nil {
		problem(w, e)
		return
	}
	a.ceremonyCookie(w, token, "login")
	writeJSON(w, 200, options)
}
func (a *api) finishPasskeyLogin(w http.ResponseWriter, r *http.Request) {
	if !a.allowedOrigin(r) {
		fail(w, 403, "origin_rejected", "请求来源不受信任")
		return
	}
	if !a.allow(w) {
		return
	}
	var v PasskeyFinishRequest
	if !decode(w, r, &v) {
		return
	}
	c, e := r.Cookie("viorka_webauthn_login")
	if e != nil {
		problem(w, auth.ErrUnauthorized)
		return
	}
	u, data, e := a.Auth.TakeCeremony(r.Context(), c.Value, "login", "")
	a.ceremonyCookie(w, "", "login")
	if e != nil {
		problem(w, e)
		return
	}
	web, e := auth.NewWebAuthn(a.Origin)
	if e != nil {
		problem(w, e)
		return
	}
	parsed, e := protocol.ParseCredentialRequestResponseBody(bytes.NewReader(v.Credential))
	if e != nil {
		problem(w, auth.ErrInvalid)
		return
	}
	key, e := web.ValidateLogin(u, data, parsed)
	if e != nil || key.Authenticator.CloneWarning {
		problem(w, auth.ErrUnauthorized)
		return
	}
	found := false
	for _, old := range u.Keys {
		if bytes.Equal(old.ID, key.ID) {
			e = a.Auth.UsePasskey(r.Context(), u.ID, old, *key)
			found = true
			break
		}
	}
	if e != nil {
		problem(w, e)
		return
	}
	if !found {
		problem(w, auth.ErrUnauthorized)
		return
	}
	m := a.requestMetadata(r, "passkey")
	m.PasskeyID = base64.RawURLEncoding.EncodeToString(key.ID)
	ctx := auth.WithLoginMetadata(r.Context(), m)
	token, s, e := a.Auth.CreateSession(ctx, u.User)
	if e != nil {
		problem(w, e)
		return
	}
	a.cookie(w, token, 43200)
	writeJSON(w, 200, s)
}

func (a *api) trustedProxy(ip netip.Addr) bool {
	for _, prefix := range a.TrustedProxies {
		if prefix.Contains(ip) {
			return true
		}
	}
	return false
}
func (a *api) ipLocation(ip string) string {
	if ip == "" {
		return "未记录"
	}
	if inventory.LocationIP(ip, ip) == "" {
		return "内网 / 非公网地址"
	}
	if a.Locations == nil {
		return "归属地未知"
	}
	location, e := a.Locations.Lookup(ip)
	if e != nil || location.CountryCode == "" {
		return "归属地未知"
	}
	parts := []string{location.CountryCode}
	if location.Subdivision != "" {
		parts = append(parts, location.Subdivision)
	}
	if location.City != "" {
		parts = append(parts, location.City)
	}
	return strings.Join(parts, " / ")
}
