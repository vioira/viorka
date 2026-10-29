package migrations

import "embed"

// Files is the immutable, ordered schema history shipped with the server.
//
//go:embed *.up.sql
var Files embed.FS
