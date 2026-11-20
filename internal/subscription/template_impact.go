package subscription

import (
	"bytes"
	"strconv"
	"unicode/utf8"
)

// TemplateSubscriber identifies a subscription that selects an enabled rule for this template.
type TemplateSubscriber struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	OwnerName string `json:"owner_name"`
}
type TemplateImpactPage struct {
	Items      []TemplateSubscriber `json:"items"`
	NextCursor string               `json:"next_cursor"`
}
type TemplateRevision struct {
	Version    int64  `json:"version"`
	ArchivedAt string `json:"archived_at"`
}
type TemplateRevisions struct {
	Items []TemplateRevision `json:"items"`
}
type TemplateRestore struct {
	Version            int64 `json:"version" minimum:"1"`
	SourceVersion      int64 `json:"source_version" minimum:"1"`
	ExpectedReferences int   `json:"expected_references" minimum:"0"`
	Confirm            bool  `json:"confirm"`
}
type TemplateComparison struct {
	Services      int    `json:"services"`
	Changed       bool   `json:"changed"`
	StartLine     int    `json:"start_line"`
	Before        string `json:"before"`
	After         string `json:"after"`
	Truncated     bool   `json:"truncated"`
	BeforeInvalid bool   `json:"before_invalid"`
	AfterInvalid  bool   `json:"after_invalid"`
}

// MaskTemplateNodes builds a fresh allowlisted representation before the template,
// regular expressions or scripts can inspect node data. Only resource labels and
// their ordering affect this preview. Connection details use reserved examples.
func MaskTemplateNodes(nodes []ClientNode) []ClientNode {
	out := make([]ClientNode, 0, len(nodes))
	example := previewNodes()[0]
	for i, node := range nodes {
		preview := example
		preview.ServiceRef = node.ServiceRef
		preview.Name = node.Name
		preview.Host = "node-" + strconv.Itoa(i+1) + ".example.invalid"
		preview.ServerName = "example.invalid"
		out = append(out, preview)
	}
	return out
}

// CompareTemplateOutput removes equal leading and trailing lines in linear time.
// A large template or single long line never produces an unbounded diff response.
func CompareTemplateOutput(before, after []byte) TemplateComparison {
	result := TemplateComparison{Changed: !bytes.Equal(before, after), StartLine: 1}
	if !result.Changed {
		return result
	}
	for len(before) > 0 && len(after) > 0 {
		i := bytes.IndexByte(before, '\n')
		if i < 0 || i >= len(after) || !bytes.Equal(before[:i+1], after[:i+1]) {
			break
		}
		before, after = before[i+1:], after[i+1:]
		result.StartLine++
	}
	for len(before) > 0 && len(after) > 0 {
		end := len(before)
		if before[end-1] == '\n' {
			end--
		}
		i := bytes.LastIndexByte(before[:end], '\n') + 1
		last := before[i:]
		j := len(after) - len(last)
		if j < 0 || (j > 0 && after[j-1] != '\n') || !bytes.Equal(last, after[j:]) {
			break
		}
		before, after = before[:i], after[:j]
	}
	const limit = 16 * 1024
	excerpt := func(b []byte) string {
		if len(b) > limit {
			result.Truncated = true
			cut := limit
			for cut > 0 && !utf8.RuneStart(b[cut]) {
				cut--
			}
			b = b[:cut]
		}
		return string(b)
	}
	result.Before, result.After = excerpt(before), excerpt(after)
	return result
}
