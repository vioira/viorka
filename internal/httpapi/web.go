package httpapi

import (
	"errors"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// webHandler serves the built SPA without turning missing assets into HTML.
func webHandler(web fs.FS) http.Handler {
	files := http.FileServerFS(web)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		for _, part := range strings.Split(name, "/") {
			if strings.HasPrefix(part, ".") {
				http.NotFound(w, r)
				return
			}
		}
		if name != "" {
			info, err := fs.Stat(web, name)
			if err == nil && !info.IsDir() {
				files.ServeHTTP(w, r)
				return
			}
			if err != nil && !errors.Is(err, fs.ErrNotExist) {
				http.Error(w, "Web 文件读取失败", http.StatusInternalServerError)
				return
			}
			if path.Ext(name) != "" || name == "assets" || strings.HasPrefix(name, "assets/") {
				http.NotFound(w, r)
				return
			}
		}
		if _, err := fs.Stat(web, "index.html"); err != nil {
			http.Error(w, "Web 尚未构建，请运行 pnpm --dir web build", http.StatusServiceUnavailable)
			return
		}
		// Serve index through / to avoid FileServer's index.html redirect.
		r = r.Clone(r.Context())
		r.URL.Path = "/"
		files.ServeHTTP(w, r)
	})
}
