FROM node:22-alpine AS web
WORKDIR /src/web
RUN npm install --global pnpm@11.18.0
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm run build

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY migrations/ ./migrations/
COPY protocol/ ./protocol/
COPY api/ ./api/
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/viorka-server ./cmd/server
RUN mkdir -p /out/data && chown 65532:65532 /out/data

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/viorka-server /app/viorka-server
COPY --from=build --chown=65532:65532 /out/data /app/data
COPY --from=web /src/web/dist /app/web/dist
ENV VIORKA_LISTEN=0.0.0.0:8080 \
    VIORKA_DATABASE=/app/data/viorka.db \
    VIORKA_WEB_DIR=/app/web/dist
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/app/viorka-server"]
