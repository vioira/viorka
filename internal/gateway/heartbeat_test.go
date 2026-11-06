package gateway

import (
	"context"
	"errors"
	"testing"
	"time"
)

type heartbeatPolicyRepo struct {
	Repository
	timeout time.Duration
	err     error
}

func (r *heartbeatPolicyRepo) HeartbeatTimeout(context.Context) (time.Duration, error) {
	return r.timeout, r.err
}

func TestHeartbeatExpiryUsesCurrentPolicy(t *testing.T) {
	repo := &heartbeatPolicyRepo{timeout: 300 * time.Second}
	g := &Gateway{repo: repo}
	last := time.Now()
	check := func(age time.Duration, want bool) {
		t.Helper()
		got, err := g.heartbeatExpired(context.Background(), last, last.Add(age))
		if err != nil || got != want {
			t.Fatalf("age %s: expired=%v, err=%v", age, got, err)
		}
	}
	check(90*time.Second, false)
	check(300*time.Second, false)
	check(300*time.Second+time.Nanosecond, true)
	repo.timeout = 600 * time.Second
	check(301*time.Second, false)
	repo.timeout = 60 * time.Second
	check(60*time.Second, false)
	check(61*time.Second, true)
	repo.err = errors.New("policy unavailable")
	if expired, err := g.heartbeatExpired(context.Background(), last, last.Add(time.Minute*2)); expired || !errors.Is(err, repo.err) {
		t.Fatalf("unavailable policy: %v %v", expired, err)
	}
}
