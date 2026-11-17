package subscription

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/dop251/goja"
	"gopkg.in/yaml.v3"
)

var reflectStringType = reflect.TypeOf("")

const MaxTemplateSize = 128 * 1024
const MaxConfigSize = 2 * 1024 * 1024

// Templates are administrator-managed. Credentials are inserted only at download time.
type Template struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	Format       string        `json:"format" enum:"mihomo,sing-box,loon"`
	Body         string        `json:"body"`
	Replacements []Replacement `json:"replacements"`
	Script       string        `json:"script"`
	Version      int64         `json:"version"`
	References   int           `json:"references"`
	Builtin      bool          `json:"builtin"`
}
type TemplateEdit struct {
	Name               string        `json:"name" maxLength:"128"`
	Format             string        `json:"format" enum:"mihomo,sing-box,loon"`
	Body               string        `json:"body" maxLength:"131072"`
	Replacements       []Replacement `json:"replacements" maxItems:"32"`
	Script             string        `json:"script" maxLength:"16384"`
	Version            int64         `json:"version"`
	ExpectedReferences int           `json:"expected_references"`
	Confirm            bool          `json:"confirm"`
}
type Replacement struct {
	Pattern     string `json:"pattern" maxLength:"1024"`
	Replacement string `json:"replacement" maxLength:"4096"`
	Parameter   string `json:"parameter" maxLength:"64"`
	Value       string `json:"value" maxLength:"256"`
}
type TemplateRequest struct {
	UserAgent string            `json:"user_agent" maxLength:"1024"`
	Params    map[string]string `json:"params"`
}

var parameterName = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

func ValidateTemplateRequest(r TemplateRequest) error {
	if len(r.UserAgent) > MaxUserAgent || len(r.Params) > 16 {
		return ErrInvalid
	}
	for k, v := range r.Params {
		if !parameterName.MatchString(k) || len(v) > 256 {
			return ErrInvalid
		}
	}
	return nil
}
func ValidateTemplate(v TemplateEdit) error {
	if !ValidName(v.Name) || !ValidFormat(v.Format) || len(v.Body) == 0 || len(v.Body) > MaxTemplateSize || len(v.Script) > 16384 || len(v.Replacements) > 32 || v.Version < 0 || v.ExpectedReferences < 0 {
		return ErrInvalid
	}
	for _, r := range v.Replacements {
		if r.Pattern == "" || len(r.Pattern) > 1024 || len(r.Replacement) > 4096 || len(r.Value) > 256 || (r.Parameter != "" && !parameterName.MatchString(r.Parameter)) {
			return ErrInvalid
		}
		if _, err := regexp.Compile(r.Pattern); err != nil {
			return fmt.Errorf("%w: 正则表达式无效", ErrInvalid)
		}
	}
	if v.Script != "" {
		if _, err := goja.Compile("template.js", scriptSource(v.Script), true); err != nil {
			return fmt.Errorf("%w: JavaScript 语法错误", ErrInvalid)
		}
	}
	// Check structure with an explicitly synthetic node; no stored credentials are read.
	_, _, err := renderTemplateBody(v.Format, v.Body, 7890, previewNodes())
	return err
}
func previewNodes() []ClientNode {
	return []ClientNode{{ServiceRef: ServiceRef{NodeID: "preview", EngineID: "preview", ServiceID: "preview"}, Name: "示例节点", Engine: "sing-box", EngineVersion: "1.14.4", Host: "example.com", Port: 443, UUID: "00000000-0000-4000-8000-000000000000", ServerName: "example.com", PublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", ShortID: "0123456789abcdef"}}
}
func PreviewTemplate(ctx context.Context, edit TemplateEdit, request TemplateRequest) (Rendered, error) {
	if err := ValidateTemplate(edit); err != nil {
		return Rendered{}, err
	}
	return RenderTemplate(ctx, Template{Format: edit.Format, Body: edit.Body, Replacements: edit.Replacements, Script: edit.Script}, 7890, previewNodes(), request)
}
func renderTemplateBody(format, body string, port int, nodes []ClientNode) ([]byte, string, error) {
	base, contentType, err := Render(format, port, nodes)
	if err != nil {
		return nil, "", err
	}
	names := clientNames(nodes)
	encode := func(v any) string { b, _ := json.Marshal(v); return string(b) }
	direct := "DIRECT"
	if format == SingBox {
		direct = "direct"
	}
	choices := append(append([]string{}, names...), direct)
	vars := map[string]string{"port": strconv.Itoa(port), "proxy_names": encode(names), "proxy_choices": encode(choices), "default_proxy": encode(names[0])}
	switch format {
	case Mihomo:
		var config map[string]any
		if err = yaml.Unmarshal(base, &config); err != nil {
			return nil, "", err
		}
		vars["proxies"] = encode(config["proxies"])
	case SingBox:
		var config struct {
			Outbounds []json.RawMessage `json:"outbounds"`
		}
		if err = json.Unmarshal(base, &config); err != nil {
			return nil, "", err
		}
		entries := []string{}
		for _, entry := range config.Outbounds[2:] {
			entries = append(entries, string(entry))
		}
		vars["proxies"] = strings.Join(entries, ",\n")
	case Loon:
		parts := strings.SplitN(string(base), "[Proxy]\n", 2)
		vars["proxies"] = strings.SplitN(parts[1], "\n[Proxy Group]", 2)[0]
		vars["proxy_names"] = strings.Join(names, ", ")
		vars["proxy_choices"] = strings.Join(choices, ", ")
		vars["default_proxy"] = names[0]
	}
	// One pass: user-controlled node names are never interpreted as template syntax.
	var out strings.Builder
	for {
		start := strings.Index(body, "{{")
		if start < 0 {
			out.WriteString(body)
			break
		}
		out.WriteString(body[:start])
		body = body[start+2:]
		end := strings.Index(body, "}}")
		if end < 0 {
			return nil, "", fmt.Errorf("%w: 模板变量缺少结束符", ErrInvalid)
		}
		value, ok := vars[strings.TrimSpace(body[:end])]
		if !ok {
			return nil, "", fmt.Errorf("%w: 模板包含未知变量", ErrInvalid)
		}
		if out.Len()+len(value) > MaxConfigSize {
			return nil, "", ErrInvalid
		}
		out.WriteString(value)
		body = body[end+2:]
	}
	result := []byte(out.String())
	if err = validateConfig(format, result); err != nil {
		return nil, "", err
	}
	return result, contentType, nil
}
func validateConfig(format string, body []byte) error {
	if len(body) == 0 || len(body) > MaxConfigSize {
		return fmt.Errorf("%w: 配置为空或超过 2 MiB", ErrInvalid)
	}
	switch format {
	case SingBox:
		var value map[string]json.RawMessage
		if json.Unmarshal(body, &value) != nil || value == nil {
			return fmt.Errorf("%w: sing-box 配置必须是 JSON 对象", ErrInvalid)
		}
	case Mihomo:
		var value map[string]any
		decoder := yaml.NewDecoder(bytes.NewReader(body))
		if decoder.Decode(&value) != nil || value == nil {
			return fmt.Errorf("%w: Mihomo YAML 无效", ErrInvalid)
		}
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			return fmt.Errorf("%w: 只允许一份 YAML 配置", ErrInvalid)
		}
	case Loon:
		for _, section := range []string{"[General]", "[Proxy]", "[Proxy Group]", "[Rule]"} {
			if !strings.Contains(string(body), section) {
				return fmt.Errorf("%w: Loon 配置缺少必要区块", ErrInvalid)
			}
		}
	}
	return nil
}
func scriptSource(script string) string {
	return "(function(config, context) {\n\"use strict\";\n" + script + "\n})"
}

// No filesystem, network, process, console, or host-object bindings are exposed.
func runTemplateScript(ctx context.Context, script, body string, request TemplateRequest) (string, error) {
	runtime := goja.New()
	runtime.SetMaxCallStackSize(128)
	stop := context.AfterFunc(ctx, func() { runtime.Interrupt("cancelled") })
	defer stop()
	timer := time.AfterFunc(100*time.Millisecond, func() { runtime.Interrupt("timeout") })
	defer timer.Stop()
	value, err := runtime.RunString(scriptSource(script))
	if err != nil {
		return "", fmt.Errorf("%w: JavaScript 执行失败或超时", ErrInvalid)
	}
	fn, _ := goja.AssertFunction(value)
	// JSON decoding creates pure JS objects instead of exposing Go reflection.
	params := request.Params
	if params == nil {
		params = map[string]string{}
	}
	raw, _ := json.Marshal(map[string]any{"userAgent": request.UserAgent, "params": params})
	contextValue, err := runtime.RunString("(" + string(raw) + ")")
	if err != nil {
		return "", ErrInvalid
	}
	result, err := fn(goja.Undefined(), runtime.ToValue(body), contextValue)
	if err != nil {
		return "", fmt.Errorf("%w: JavaScript 执行失败或超时", ErrInvalid)
	}
	if result.ExportType() != reflectStringType {
		return "", fmt.Errorf("%w: JavaScript 必须返回配置字符串", ErrInvalid)
	}
	return result.String(), nil
}
func RenderTemplate(ctx context.Context, v Template, port int, nodes []ClientNode, request TemplateRequest) (Rendered, error) {
	if err := ValidateTemplateRequest(request); err != nil {
		return Rendered{}, err
	}
	if err := ctx.Err(); err != nil {
		return Rendered{}, err
	}
	body, contentType, err := renderTemplateBody(v.Format, v.Body, port, nodes)
	if err != nil {
		return Rendered{}, err
	}
	for _, r := range v.Replacements {
		if r.Parameter != "" {
			value, ok := request.Params[r.Parameter]
			if !ok || value != r.Value {
				continue
			}
		}
		rx, err := regexp.Compile(r.Pattern)
		if err != nil {
			return Rendered{}, ErrInvalid
		}
		// Bound expansion before allocating the full result.
		var replaced bytes.Buffer
		last := 0
		for _, match := range rx.FindAllSubmatchIndex(body, -1) {
			piece := rx.Expand(nil, []byte(r.Replacement), body, match)
			if replaced.Len()+match[0]-last+len(piece) > MaxConfigSize {
				return Rendered{}, ErrInvalid
			}
			replaced.Write(body[last:match[0]])
			replaced.Write(piece)
			last = match[1]
		}
		if replaced.Len()+len(body)-last > MaxConfigSize {
			return Rendered{}, ErrInvalid
		}
		replaced.Write(body[last:])
		body = replaced.Bytes()
	}
	if v.Script != "" {
		result, e := runTemplateScript(ctx, v.Script, string(body), request)
		if e != nil {
			return Rendered{}, e
		}
		body = []byte(result)
	}
	if err := validateConfig(v.Format, body); err != nil {
		return Rendered{}, err
	}
	return Rendered{Body: body, ContentType: contentType}, nil
}
