package storage

import (
	"encoding/json"
	"fmt"
	"sort"

	"github.com/vioira/viorka/internal/subscription"
	v1 "github.com/vioira/viorka/protocol/v1"
)

type recoveryField struct{ resource, field string }
type recoveryValue struct {
	value  string
	secret bool
}

// Explicitly allowlist public fields. Never serialize an entire command or
// outbound into the REST preview: both contain credentials.
func recoveryFields(c v1.EngineCommand) map[recoveryField]recoveryValue {
	fields := map[recoveryField]recoveryValue{}
	put := func(resource, field string, value any, secret bool) {
		raw, _ := json.Marshal(value)
		text := string(raw)
		if v, ok := value.(string); ok {
			text = v
		}
		fields[recoveryField{resource, field}] = recoveryValue{text, secret}
	}
	put("引擎", "版本", c.Version, false)
	put("引擎", "运行意愿", c.RunIntent, false)
	for _, s := range c.Services {
		r := "服务 / " + s.ID
		for k, v := range map[string]any{"名称": s.Name, "启用": s.Enabled, "监听地址": s.ListenHost, "监听端口": s.ListenPort, "目标地址": s.TargetHost, "目标端口": s.TargetPort, "服务器名称": s.ServerName} {
			put(r, k, v, false)
		}
		put(r, "凭证", []any{s.Uuid, s.PrivateKey, s.ShortIds}, true)
	}
	for _, o := range c.Outbounds {
		r := "出口 / " + o.ID
		for k, v := range map[string]any{"名称": o.Name, "类型": o.Type, "服务器": o.Server, "端口": o.ServerPort, "TLS": o.Tls, "服务器名称": o.ServerName, "流控": o.Flow, "指纹": o.Fingerprint} {
			put(r, k, v, false)
		}
		put(r, "凭证", []string{o.Username, o.Password, o.Uuid, o.PublicKey, o.ShortID}, true)
	}
	if c.Routing != nil {
		put("分流", "默认出口", c.Routing.Final, false)
		put("分流", "协议嗅探", c.Routing.Sniff, false)
		put("分流", "引用出口", c.Routing.OutboundIds, false)
		order := []string{}
		for _, rule := range c.Routing.Rules {
			order = append(order, rule.ID)
			r := "分流规则 / " + rule.ID
			for k, v := range map[string]any{"名称": rule.Name, "启用": rule.Enabled, "入站": rule.Inbound, "域名": rule.Domain, "域名后缀": rule.DomainSuffix, "IP 网段": rule.IpCidr, "端口": rule.Port, "端口范围": rule.PortRange, "传输协议": rule.Network, "出口": rule.Outbound, "匹配全部": rule.MatchAll} {
				put(r, k, v, false)
			}
		}
		put("分流", "规则顺序", order, false)
	}
	return fields
}

func recoveryChanges(before, after v1.EngineCommand) []subscription.RestoreChange {
	a, b := recoveryFields(before), recoveryFields(after)
	keys := make([]recoveryField, 0, len(a)+len(b))
	for k := range a {
		keys = append(keys, k)
	}
	for k := range b {
		if _, ok := a[k]; !ok {
			keys = append(keys, k)
		}
	}
	sort.Slice(keys, func(i, j int) bool { return fmt.Sprint(keys[i]) < fmt.Sprint(keys[j]) })
	changes := []subscription.RestoreChange{}
	for _, k := range keys {
		old, existsBefore := a[k]
		next, existsAfter := b[k]
		if existsBefore == existsAfter && old.value == next.value {
			continue
		}
		left, right := old.value, next.value
		if old.secret || next.secret {
			left, right = "已隐藏", "已变化（值已隐藏）"
		}
		if !existsBefore {
			left = "不存在"
		}
		if !existsAfter {
			right = "不存在"
		}
		changes = append(changes, subscription.RestoreChange{Resource: k.resource, Field: k.field, Before: left, After: right})
	}
	return changes
}
