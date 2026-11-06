package audit

import (
	"context"
	"testing"
	"time"
)

func TestSourceContext(t *testing.T) {
	parent, cancel := context.WithDeadline(context.Background(), time.Now().Add(time.Minute))
	defer cancel()
	if SourceIP(parent) != "" {
		t.Fatal("background source must be unknown")
	}
	for _, tc := range []struct{ input, want string }{
		{"::ffff:192.0.2.1", "192.0.2.1"},
		{"2001:db8::1", "2001:db8::1"},
		{"invalid", ""},
	} {
		ctx := WithSourceIP(parent, tc.input)
		if got := SourceIP(ctx); got != tc.want {
			t.Fatalf("source=%q want=%q", got, tc.want)
		}
		want, _ := parent.Deadline()
		if got, ok := ctx.Deadline(); !ok || !got.Equal(want) {
			t.Fatal("deadline lost")
		}
	}
	ctx := WithSourceIP(parent, "192.0.2.1")
	cancel()
	if ctx.Err() != context.Canceled {
		t.Fatal("cancellation lost")
	}
}
