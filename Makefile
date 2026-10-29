.PHONY: run test fmt-check build
run:
	go run ./cmd/server

test:
	go test ./...

fmt-check:
	@test -z "$$(gofmt -l $$(find . -name '*.go' -type f))" || (echo 'Run gofmt -w on Go files' && exit 1)

build:
	mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -o bin/viorka-server ./cmd/server
