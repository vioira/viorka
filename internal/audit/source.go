package audit

import (
	"context"
	"net/netip"
)

type sourceIPKey struct{}

// WithSourceIP attaches the request source resolved by the trusted HTTP boundary.
// It preserves cancellation and deadlines; absent or invalid addresses stay unknown.
func WithSourceIP(ctx context.Context, source string) context.Context {
	ip, err := netip.ParseAddr(source)
	if err != nil {
		source = ""
	} else {
		source = ip.Unmap().String()
	}
	return context.WithValue(ctx, sourceIPKey{}, source)
}

// SourceIP returns an empty string for background work without a request source.
func SourceIP(ctx context.Context) string {
	source, _ := ctx.Value(sourceIPKey{}).(string)
	return source
}
