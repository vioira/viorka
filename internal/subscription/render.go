package subscription

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

const selectorName = "节点选择"

var privateNetworks = []string{
	"10.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16",
	"::1/128", "fc00::/7", "fe80::/10",
}

// Compatible applies the documented first-release client/server compatibility
// boundary. User-Agent does not attest the installed client version.
func Compatible(format string, n ClientNode) bool {
	if n.Engine != "xray" {
		return true
	}
	switch format {
	case Mihomo:
		return !xrayAtLeast(n.EngineVersion, [3]int{26, 7, 11})
	case SingBox:
		return !xrayAtLeast(n.EngineVersion, [3]int{26, 9, 8})
	default:
		return true
	}
}

func xrayAtLeast(version string, want [3]int) bool {
	parts := strings.Split(strings.TrimPrefix(version, "v"), ".")
	if len(parts) != 3 {
		return true // Unknown Xray versions are not advertised as compatible.
	}
	for i, part := range parts {
		v, err := strconv.Atoi(part)
		if err != nil || v < 0 {
			return true
		}
		if v != want[i] {
			return v > want[i]
		}
	}
	return true
}

// Render generates a complete client configuration. All nodes must already
// have passed resource authorization, publication, recovery and compatibility
// checks. No private key or unrelated service credential is accepted.
func Render(format string, port int, nodes []ClientNode) ([]byte, string, error) {
	if !ValidFormat(format) || port < 1 || port > 65535 {
		return nil, "", ErrInvalid
	}
	if len(nodes) == 0 || len(nodes) > MaxServices {
		return nil, "", ErrNoServices
	}
	for _, n := range nodes {
		if n.Name == "" || n.NodeID == "" || n.EngineID == "" || n.ServiceID == "" || n.Host == "" || n.Port < 1 || n.Port > 65535 || n.UUID == "" || n.ServerName == "" || n.PublicKey == "" || n.ShortID == "" || !Compatible(format, n) {
			return nil, "", ErrInvalid
		}
	}
	names := clientNames(nodes)
	switch format {
	case Mihomo:
		return renderMihomo(port, nodes, names), "application/yaml; charset=utf-8", nil
	case SingBox:
		b, err := renderSingBox(nodes, names)
		return b, "application/json; charset=utf-8", err
	case Loon:
		return renderLoon(nodes, names), "text/plain; charset=utf-8", nil
	default:
		return nil, "", ErrInvalid
	}
}

// Client names are kept safe for Loon's comma-delimited configuration as well
// as YAML and JSON. Collision suffixes are derived from resource identity, not
// from secrets or ordering.
func clientNames(nodes []ClientNode) []string {
	names := make([]string, len(nodes))
	count := make(map[string]int, len(nodes))
	for i, n := range nodes {
		name := strings.Map(func(r rune) rune {
			if unicode.IsControl(r) || strings.ContainsRune(",=\"'\\[]#", r) {
				return '_'
			}
			return r
		}, n.Name)
		name = strings.TrimSpace(name)
		if name == "" {
			name = "服务"
		}
		names[i] = name
		count[strings.ToLower(name)]++
	}
	seen := map[string]bool{strings.ToLower(selectorName): true, "direct": true, "reject": true}
	for i, n := range nodes {
		key := strings.ToLower(names[i])
		if count[key] > 1 || seen[key] {
			hash := sha256.Sum256([]byte(n.NodeID + "\x00" + n.EngineID + "\x00" + n.ServiceID))
			names[i] += " (" + hex.EncodeToString(hash[:4]) + ")"
			key = strings.ToLower(names[i])
		}
		// Duplicate resource references are rejected before rendering. Still
		// disambiguate defensively if an eight-digit hash collides.
		if seen[key] {
			hash := sha256.Sum256([]byte(n.NodeID + "\x00" + n.EngineID + "\x00" + n.ServiceID))
			names[i] += "-" + hex.EncodeToString(hash[4:])
			key = strings.ToLower(names[i])
		}
		seen[key] = true
	}
	return names
}

// JSON quoted strings are also valid YAML double-quoted scalars. Using a
// serializer rather than interpolation prevents configuration injection.
func yamlString(v string) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func renderMihomo(port int, nodes []ClientNode, names []string) []byte {
	var b strings.Builder
	fmt.Fprintf(&b, "mixed-port: %d\nallow-lan: false\nbind-address: %s\nmode: rule\nipv6: true\ndns:\n  enable: false\nproxies:\n", port, yamlString("127.0.0.1"))
	for i, n := range nodes {
		fmt.Fprintf(&b, "  - name: %s\n    type: vless\n    server: %s\n    port: %d\n    uuid: %s\n    network: tcp\n    udp: false\n    tls: true\n    servername: %s\n    client-fingerprint: chrome\n    flow: xtls-rprx-vision\n    reality-opts:\n      public-key: %s\n      short-id: %s\n", yamlString(names[i]), yamlString(n.Host), n.Port, yamlString(n.UUID), yamlString(n.ServerName), yamlString(n.PublicKey), yamlString(n.ShortID))
	}
	fmt.Fprintf(&b, "proxy-groups:\n  - name: %s\n    type: select\n    proxies:\n", yamlString(selectorName))
	for _, name := range names {
		fmt.Fprintf(&b, "      - %s\n", yamlString(name))
	}
	b.WriteString("      - DIRECT\nrules:\n")
	for _, network := range privateNetworks {
		kind := "IP-CIDR"
		if strings.Contains(network, ":") {
			kind = "IP-CIDR6"
		}
		fmt.Fprintf(&b, "  - %s\n", yamlString(kind+","+network+",DIRECT,no-resolve"))
	}
	fmt.Fprintf(&b, "  - %s\n", yamlString("MATCH,"+selectorName))
	return []byte(b.String())
}

func renderSingBox(nodes []ClientNode, names []string) ([]byte, error) {
	members := append(append([]string{}, names...), "direct")
	outbounds := []any{map[string]any{"type": "selector", "tag": selectorName, "outbounds": members, "default": names[0]}, map[string]any{"type": "direct", "tag": "direct"}}
	for i, n := range nodes {
		outbounds = append(outbounds, map[string]any{
			"type": "vless", "tag": names[i], "server": n.Host, "server_port": n.Port,
			"uuid": n.UUID, "flow": "xtls-rprx-vision", "network": "tcp",
			"tls": map[string]any{"enabled": true, "server_name": n.ServerName,
				"utls":    map[string]any{"enabled": true, "fingerprint": "chrome"},
				"reality": map[string]any{"enabled": true, "public_key": n.PublicKey, "short_id": n.ShortID}},
		})
	}
	config := map[string]any{
		"log":       map[string]any{"level": "warn"},
		"dns":       map[string]any{"servers": []any{map[string]any{"type": "local", "tag": "system-dns"}}, "final": "system-dns"},
		"inbounds":  []any{map[string]any{"type": "tun", "tag": "tun-in", "address": []string{"172.19.0.1/30", "fdfe:dcba:9876::1/126"}, "auto_route": true}},
		"outbounds": outbounds,
		"route": map[string]any{"auto_detect_interface": true, "default_domain_resolver": "system-dns",
			"rules": []any{map[string]any{"ip_is_private": true, "action": "route", "outbound": "direct"}}, "final": selectorName},
	}
	b, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(b, '\n'), nil
}

func renderLoon(nodes []ClientNode, names []string) []byte {
	var b strings.Builder
	b.WriteString("[General]\ndns-server = system\nudp-fallback-mode = REJECT\n\n[Proxy]\n")
	for i, n := range nodes {
		fmt.Fprintf(&b, "%s = VLESS,%s,%d,%s,transport=tcp,flow=xtls-rprx-vision,public-key=%s,short-id=%s,over-tls=true,sni=%s,tls-profile=chrome,udp=false\n", names[i], n.Host, n.Port, strconv.Quote(n.UUID), strconv.Quote(n.PublicKey), n.ShortID, n.ServerName)
	}
	fmt.Fprintf(&b, "\n[Proxy Group]\n%s = select, %s, DIRECT\n\n[Rule]\n", selectorName, strings.Join(names, ", "))
	for _, network := range privateNetworks {
		kind := "IP-CIDR"
		if strings.Contains(network, ":") {
			kind = "IP-CIDR6"
		}
		fmt.Fprintf(&b, "%s,%s,DIRECT,no-resolve\n", kind, network)
	}
	fmt.Fprintf(&b, "FINAL,%s\n", selectorName)
	return []byte(b.String())
}
