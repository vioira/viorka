package storage

import (
	"context"
	"database/sql/driver"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/stdlib"
)

// postgresConnector keeps the repository's positional SQL and integer flags at
// the database boundary, including statements executed inside sql.Tx.
type postgresConnector struct{ driver.Connector }

func (c postgresConnector) Connect(ctx context.Context) (driver.Conn, error) {
	conn, err := c.Connector.Connect(ctx)
	if err != nil {
		return nil, err
	}
	return &postgresConn{Conn: conn.(*stdlib.Conn)}, nil
}

type postgresConn struct{ *stdlib.Conn }

func (c *postgresConn) CheckNamedValue(v *driver.NamedValue) error {
	if b, ok := v.Value.(bool); ok {
		v.Value = int64(0)
		if b {
			v.Value = int64(1)
		}
		return nil
	}
	var err error
	v.Value, err = driver.DefaultParameterConverter.ConvertValue(v.Value)
	return err
}
func (c *postgresConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	return c.Conn.ExecContext(ctx, postgresSQL(query), args)
}
func (c *postgresConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	rows, err := c.Conn.QueryContext(ctx, postgresSQL(query), args)
	if err != nil {
		return nil, err
	}
	return postgresRows{rows}, nil
}
func (c *postgresConn) PrepareContext(ctx context.Context, query string) (driver.Stmt, error) {
	return c.Conn.PrepareContext(ctx, postgresSQL(query))
}
func (c *postgresConn) Prepare(query string) (driver.Stmt, error) {
	return c.PrepareContext(context.Background(), query)
}

type postgresRows struct{ driver.Rows }

func (r postgresRows) Next(values []driver.Value) error {
	if err := r.Rows.Next(values); err != nil {
		return err
	}
	for i, value := range values {
		if b, ok := value.(bool); ok {
			values[i] = int64(0)
			if b {
				values[i] = int64(1)
			}
		}
	}
	return nil
}

// SQL comes only from repository statements. Preserve quoted strings,
// identifiers, comments and dollar-quoted function bodies when rebinding.
func postgresSQL(query string) string {
	if query == historyCurrentDDL || query == tcpHistoryDDL {
		query = strings.NewReplacer(" INTEGER", " BIGINT", " REAL", " DOUBLE PRECISION",
			") STRICT;", ");", "typeof(loss_1)='integer' AND ", "", "typeof(loss_2)='integer' AND ", "", "typeof(loss_3)='integer' AND ", "").Replace(query)
	}
	var out strings.Builder
	parameter := 0
	for i := 0; i < len(query); {
		start := i
		switch {
		case query[i] == '\'' || query[i] == '"':
			quote := query[i]
			i++
			for i < len(query) {
				if query[i] == quote {
					i++
					if i < len(query) && query[i] == quote {
						i++
						continue
					}
					break
				}
				i++
			}
		case strings.HasPrefix(query[i:], "--"):
			for i < len(query) && query[i] != '\n' {
				i++
			}
		case strings.HasPrefix(query[i:], "/*"):
			i += 2
			depth := 1
			for i < len(query) && depth > 0 {
				if strings.HasPrefix(query[i:], "/*") {
					depth++
					i += 2
				} else if strings.HasPrefix(query[i:], "*/") {
					depth--
					i += 2
				} else {
					i++
				}
			}
		case query[i] == '$':
			end := i + 1
			for end < len(query) && ((query[end] >= 'a' && query[end] <= 'z') || (query[end] >= 'A' && query[end] <= 'Z') || query[end] == '_' || (end > i+1 && query[end] >= '0' && query[end] <= '9')) {
				end++
			}
			if end < len(query) && query[end] == '$' {
				tag := query[i : end+1]
				if close := strings.Index(query[end+1:], tag); close >= 0 {
					i = end + 1 + close + len(tag)
				} else {
					i++
				}
			} else {
				i++
			}
		case query[i] == '?':
			parameter++
			out.WriteByte('$')
			out.WriteString(strconv.Itoa(parameter))
			i++
			continue
		default:
			i++
		}
		out.WriteString(query[start:i])
	}
	return out.String()
}
