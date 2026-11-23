package alerts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type SendResult struct {
	Accepted, Retry bool
	Detail          string
	Delay           time.Duration
}

var Client = &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

// Send only exposes classified outcomes. Provider URLs, credentials and error
// bodies must never reach the inbox, logs, or configuration API.
func Send(ctx context.Context, client *http.Client, ch Channel, secret string, m Message) SendResult {
	endpoint := ""
	var payload map[string]string
	switch ch.Kind {
	case "telegram":
		endpoint = "https://api.telegram.org/bot" + secret + "/sendMessage"
		payload = map[string]string{"chat_id": ch.Target, "text": m.Title + "\n" + m.Body}
	case "bark":
		endpoint = strings.TrimRight(ch.Target, "/") + "/push"
		payload = map[string]string{"device_key": secret, "title": m.Title, "body": m.Body}
	default:
		return SendResult{Detail: "不支持的渠道类型"}
	}
	raw, e := json.Marshal(payload)
	if e != nil {
		return SendResult{Detail: "消息编码失败"}
	}
	req, e := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if e != nil {
		return SendResult{Detail: "渠道地址无效"}
	}
	req.Header.Set("Content-Type", "application/json")
	res, e := client.Do(req)
	if e != nil {
		return SendResult{Retry: true, Detail: "连接失败或超时"}
	}
	defer res.Body.Close()
	var body struct {
		OK         bool `json:"ok"`
		Code       int  `json:"code"`
		Parameters struct {
			RetryAfter int `json:"retry_after"`
		} `json:"parameters"`
	}
	e = json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&body)
	if res.StatusCode >= 200 && res.StatusCode < 300 && e == nil && ((ch.Kind == "telegram" && body.OK) || (ch.Kind == "bark" && body.Code == 200)) {
		return SendResult{Accepted: true, Detail: "渠道已接受消息"}
	}
	return SendResult{Retry: res.StatusCode == 429 || res.StatusCode >= 500, Delay: time.Duration(min(max(body.Parameters.RetryAfter, 0), 86400)) * time.Second, Detail: fmt.Sprintf("渠道未接受消息（HTTP %d）", res.StatusCode)}
}
