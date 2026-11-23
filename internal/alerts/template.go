package alerts

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

var field = regexp.MustCompile(`\{(rule|node|metric|basis|value|threshold|window|time|duration|state)\}`)

func validText(s string, limit int) bool {
	return strings.TrimSpace(s) != "" && len(s) <= limit && !strings.ContainsAny(field.ReplaceAllString(s, ""), "{}")
}
func (t Template) Valid() bool {
	for _, m := range []Message{t.Trigger, t.Repeat, t.Recovery} {
		if !validText(m.Title, 192) || !validText(m.Body, 2048) {
			return false
		}
	}
	return true
}

var names = map[string]string{"cpu": "CPU 使用率", "memory": "内存使用率", "disk": "文件系统使用率", "upload": "上行速率", "download": "下行速率", "monthly": "月流量用量", "offline": "离线时长"}

func (r Rule) unit() string {
	switch r.Metric {
	case "offline":
		return " 分钟"
	case "upload", "download":
		return " MB/s"
	case "monthly":
		if r.Mode == "gb" {
			return " GB"
		}
	}
	return "%"
}
func (t Template) Render(state, node string, r Rule, value float64, at, started time.Time, zone *time.Location) Message {
	m := t.Trigger
	label := "触发"
	if state == "repeat" {
		m = t.Repeat
		label = "持续提醒"
	}
	if state == "recovery" {
		m = t.Recovery
		label = "恢复"
	}
	threshold := r.Threshold
	if r.Metric == "offline" {
		threshold = float64(r.WindowMinutes)
	}
	window := fmt.Sprintf("%d 分钟", r.WindowMinutes)
	basis := "累计用量"
	switch r.Mode {
	case "average":
		basis = window + "均值"
	case "all":
		basis = window + "最低值"
		if state == "recovery" {
			basis = window + "最高值"
		}
	case "duration":
		basis = "持续时长"
	case "gb", "percent":
		window = "本计费周期"
	}
	values := map[string]string{
		"rule": r.Name, "node": node, "metric": names[r.Metric], "basis": basis,
		"value": fmt.Sprintf("%.2f%s", value, r.unit()), "threshold": fmt.Sprintf("%g%s", threshold, r.unit()),
		"window": window, "time": at.In(zone).Format("2006-01-02 15:04:05 MST (-07:00)"),
		"duration": at.Sub(started).Round(time.Second).String(), "state": label,
	}
	render := func(s string) string {
		return field.ReplaceAllStringFunc(s, func(k string) string { return values[k[1:len(k)-1]] })
	}
	return Message{boundedText(render(m.Title), 240), boundedText(render(m.Body), 3500)}
}

func boundedText(text string, maxRunes int) string {
	r := []rune(text)
	if len(r) <= maxRunes {
		return text
	}
	return string(r[:maxRunes-1]) + "…"
}
