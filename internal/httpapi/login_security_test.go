package httpapi

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"github.com/fxamacker/cbor/v2"
	"net/http"
	"net/netip"
	"net/url"
	"testing"
)

func TestRequestMetadataProxyTrust(t *testing.T) {
	a := &api{}
	r, _ := http.NewRequest("GET", "https://example.com", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	r.Header.Set("X-Forwarded-For", "8.8.8.8, 10.0.0.1")
	if got := a.requestMetadata(r, "").IP; got != "127.0.0.1" {
		t.Fatal(got)
	}
	a.TrustedProxies = []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32"), netip.MustParsePrefix("10.0.0.0/8")}
	if got := a.requestMetadata(r, "").IP; got != "8.8.8.8" {
		t.Fatal(got)
	}
	r.Header.Set("X-Forwarded-For", "1.1.1.1, 8.8.8.8")
	if got := a.requestMetadata(r, "").IP; got != "8.8.8.8" {
		t.Fatal(got)
	}
	r.Header.Set("X-Forwarded-For", "invalid")
	if got := a.requestMetadata(r, "").IP; got != "127.0.0.1" {
		t.Fatal(got)
	}
	if got := a.ipLocation("127.0.0.1"); got != "内网 / 非公网地址" {
		t.Fatal(got)
	}
}
func TestPasskeyRegistrationAndSignedLogin(t *testing.T) {
	f := setup(t, "admin")
	request := func(path string, body any, cookie *http.Cookie, authenticated bool) *http.Response {
		b, _ := json.Marshal(body)
		r, _ := http.NewRequest("POST", f.server.URL+"/api/v1/auth/passkeys/"+path, bytes.NewReader(b))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", f.server.URL)
		if authenticated {
			r.AddCookie(f.cookie)
			r.Header.Set("X-CSRF-Token", f.session.CSRF)
		}
		if cookie != nil {
			r.AddCookie(cookie)
		}
		res, e := f.server.Client().Do(r)
		if e != nil {
			t.Fatal(e)
		}
		return res
	}
	expectStatus(t, request("register/begin", map[string]string{"password": "wrong"}, nil, true), 401)
	begin := request("register/begin", map[string]string{"password": "test-password-123"}, nil, true)
	if begin.StatusCode != 200 {
		t.Fatal(read(begin))
	}
	cookie := begin.Cookies()[0]
	var creation struct {
		PublicKey struct {
			Challenge string `json:"challenge"`
		} `json:"publicKey"`
	}
	json.NewDecoder(begin.Body).Decode(&creation)
	begin.Body.Close()
	key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	credentialID := []byte("test-credential-0123456789")
	public, e := cbor.Marshal(map[int]any{1: 2, 3: -7, -1: 1, -2: key.X.FillBytes(make([]byte, 32)), -3: key.Y.FillBytes(make([]byte, 32))})
	if e != nil {
		t.Fatal(e)
	}
	origin, _ := url.Parse(f.server.URL)
	rp := sha256.Sum256([]byte(origin.Hostname()))
	authData := append([]byte{}, rp[:]...)
	authData = append(authData, 0x45, 0, 0, 0, 0)
	authData = append(authData, make([]byte, 16)...)
	authData = binary.BigEndian.AppendUint16(authData, uint16(len(credentialID)))
	authData = append(authData, credentialID...)
	authData = append(authData, public...)
	attestation, _ := cbor.Marshal(map[string]any{"fmt": "none", "attStmt": map[string]any{}, "authData": authData})
	enc := base64.RawURLEncoding.EncodeToString
	clientData, _ := json.Marshal(map[string]any{"type": "webauthn.create", "challenge": creation.PublicKey.Challenge, "origin": f.server.URL})
	credential := map[string]any{"id": enc(credentialID), "rawId": enc(credentialID), "type": "public-key", "response": map[string]any{"clientDataJSON": enc(clientData), "attestationObject": enc(attestation)}, "clientExtensionResults": map[string]any{}}
	body := map[string]any{"name": "Test key", "credential": credential}
	expectStatus(t, request("register/finish", body, cookie, true), 204)
	expectStatus(t, request("register/finish", body, cookie, true), 401)
	keys := decodeResponse[PasskeyListResponse](t, f.request("GET", "/api/v1/auth/passkeys", nil, true), 200)
	if len(keys.Items) != 1 || keys.Items[0].Name != "Test key" {
		t.Fatal(keys)
	}
	for _, tc := range []struct {
		name, origin string
		flags        byte
		status       int
	}{{"wrong origin", "https://evil.example", 5, 401}, {"missing verification", f.server.URL, 1, 401}, {"valid", f.server.URL, 5, 200}} {
		t.Run(tc.name, func(t *testing.T) {
			begin = request("login/begin", map[string]string{"username": "admin"}, nil, false)
			if begin.StatusCode != 200 {
				t.Fatal(read(begin))
			}
			cookie = begin.Cookies()[0]
			var assertion struct {
				PublicKey struct {
					Challenge string `json:"challenge"`
				} `json:"publicKey"`
			}
			json.NewDecoder(begin.Body).Decode(&assertion)
			begin.Body.Close()
			clientData, _ = json.Marshal(map[string]any{"type": "webauthn.get", "challenge": assertion.PublicKey.Challenge, "origin": tc.origin})
			ad := append([]byte{}, rp[:]...)
			ad = append(ad, tc.flags, 0, 0, 0, 1)
			hash := sha256.Sum256(clientData)
			signed := append(append([]byte{}, ad...), hash[:]...)
			digest := sha256.Sum256(signed)
			signature, e := ecdsa.SignASN1(rand.Reader, key, digest[:])
			if e != nil {
				t.Fatal(e)
			}
			cred := map[string]any{"id": enc(credentialID), "rawId": enc(credentialID), "type": "public-key", "response": map[string]any{"clientDataJSON": enc(clientData), "authenticatorData": enc(ad), "signature": enc(signature), "userHandle": enc([]byte("user"))}, "clientExtensionResults": map[string]any{}}
			finish := map[string]any{"credential": cred}
			expectStatus(t, request("login/finish", finish, cookie, false), tc.status)
			expectStatus(t, request("login/finish", finish, cookie, false), 401)
		})
	}
	history := decodeResponse[SessionHistoryResponse](t, f.request("GET", "/api/v1/auth/sessions", nil, true), 200)
	if len(history.Items) != 2 || history.Items[0].Method != "passkey" {
		t.Fatal(history)
	}
	expectStatus(t, f.request("DELETE", "/api/v1/auth/passkeys/"+keys.Items[0].ID, nil, true), 204)
	expectStatus(t, request("login/begin", map[string]string{"username": "admin"}, nil, false), 401)
}
func TestSessionHistoryAccess(t *testing.T) {
	f := setup(t, "viewer")
	expectStatus(t, f.request("GET", "/api/v1/auth/sessions", nil, false), 401)
	for _, q := range []string{"limit=0", "limit=101", "after=missing", "sort=id"} {
		expectStatus(t, f.request("GET", "/api/v1/auth/sessions?"+q, nil, true), 400)
	}
	expectStatus(t, f.request("DELETE", "/api/v1/auth/sessions/other", nil, true), 404)
}
