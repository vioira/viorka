# API-only scaffold image. The web UI is not embedded yet (M0 task).
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY cmd/ ./cmd/
COPY internal/ ./internal/
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /out/viorka-server ./cmd/server
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/viorka-server /viorka-server
ENV VIORKA_LISTEN=0.0.0.0:8080
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/viorka-server"]
