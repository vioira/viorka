package storage

import (
	"context"
	"database/sql"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/realtime"
	"strconv"
	"strings"
)

func (s *Store) CategoryCatalog(ctx context.Context) (inventory.CategoryCatalog, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return inventory.CategoryCatalog{}, err
	}
	defer tx.Rollback()
	c := inventory.CategoryCatalog{Items: []inventory.NodeCategory{}}
	if err = tx.QueryRowContext(ctx, "SELECT category_revision FROM status_publication WHERE id=1").Scan(&c.Revision); err != nil {
		return c, err
	}
	rows, err := tx.QueryContext(ctx, "SELECT id,kind,name,shared FROM node_categories ORDER BY kind,name,id")
	if err != nil {
		return c, err
	}
	defer rows.Close()
	for rows.Next() {
		var v inventory.NodeCategory
		if err := rows.Scan(&v.ID, &v.Kind, &v.Name, &v.Shared); err != nil {
			return c, err
		}
		c.Items = append(c.Items, v)
	}
	return c, rows.Err()
}
func advanceCategories(ctx context.Context, tx *sql.Tx, revision int64) error {
	r, err := tx.ExecContext(ctx, "UPDATE status_publication SET category_revision=category_revision+1 WHERE id=1 AND category_revision=?", revision)
	if err != nil {
		return err
	}
	n, err := r.RowsAffected()
	if err == nil && n != 1 {
		return auth.ErrConflict
	}
	return err
}
func (s *Store) SaveCategories(ctx context.Context, actor string, c inventory.CategoryCatalog) error {
	if err := c.Validate(); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = advanceCategories(ctx, tx, c.Revision); err != nil {
		return err
	}
	// Retain membership on rename. Removing a category cascades its memberships only.
	ids := make([]any, 0, len(c.Items))
	for _, v := range c.Items {
		ids = append(ids, v.ID)
	}
	query := "DELETE FROM node_categories"
	if len(ids) > 0 {
		query += " WHERE id NOT IN (" + placeholders(len(ids)) + ")"
	}
	if _, err = tx.ExecContext(ctx, query, ids...); err != nil {
		return err
	}
	for i, v := range c.Items {
		var kind string
		e := tx.QueryRowContext(ctx, "SELECT kind FROM node_categories WHERE id=?", v.ID).Scan(&kind)
		if e != nil && !errors.Is(e, sql.ErrNoRows) {
			return e
		}
		if e == nil && kind != v.Kind {
			return auth.ErrInvalid
		}
		// Temporarily free old names so two existing categories can exchange names.
		if e == nil {
			if _, err = tx.ExecContext(ctx, "UPDATE node_categories SET name=? WHERE id=?", "\t"+strconv.Itoa(i), v.ID); err != nil {
				return err
			}
		}
	}
	for _, v := range c.Items {
		if _, err = tx.ExecContext(ctx, `INSERT INTO node_categories(id,kind,name,shared) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,shared=excluded.shared`, v.ID, v.Kind, v.Name, v.Shared); err != nil {
			return err
		}
	}
	if err = audit(ctx, tx, actor, "nodes.categories.save", "settings", "categories"); err != nil {
		return err
	}
	return s.commitChanges(tx, realtime.Change{Kind: "nodes"})
}
func placeholders(n int) string { return strings.TrimSuffix(strings.Repeat("?,", n), ",") }
func (s *Store) AssignCategories(ctx context.Context, actor string, v inventory.CategoryAssignment) error {
	if v.Revision < 1 || len(v.Nodes) == 0 || len(v.Nodes) > 256 {
		return auth.ErrInvalid
	}
	kind := "tag"
	switch v.Action {
	case "group":
		kind = "group"
	case "add", "remove":
		if v.Category == "" {
			return auth.ErrInvalid
		}
	default:
		return auth.ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = advanceCategories(ctx, tx, v.Revision); err != nil {
		return err
	}
	if v.Category != "" {
		var actual string
		err = tx.QueryRowContext(ctx, "SELECT kind FROM node_categories WHERE id=?", v.Category).Scan(&actual)
		if errors.Is(err, sql.ErrNoRows) {
			return auth.ErrNotFound
		}
		if err != nil {
			return err
		}
		if kind != actual {
			return auth.ErrInvalid
		}
	}
	for _, id := range v.Nodes {
		var found bool
		if err = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM nodes WHERE id=?)", id).Scan(&found); err != nil {
			return err
		}
		if !found {
			return auth.ErrNotFound
		}
		switch v.Action {
		case "group":
			_, err = tx.ExecContext(ctx, "DELETE FROM node_category_members WHERE node_id=? AND kind='group'", id)
		case "remove":
			_, err = tx.ExecContext(ctx, "DELETE FROM node_category_members WHERE node_id=? AND category_id=?", id, v.Category)
		}
		if err != nil {
			return err
		}
		if v.Category != "" && v.Action != "remove" {
			if _, err = tx.ExecContext(ctx, "INSERT INTO node_category_members(node_id,category_id,kind) VALUES(?,?,?) ON CONFLICT(node_id,category_id) DO NOTHING", id, v.Category, kind); err != nil {
				return err
			}
		}
		if err = audit(ctx, tx, actor, "node.categories."+v.Action, "node", id); err != nil {
			return err
		}
	}
	return s.commitChanges(tx, realtime.Change{Kind: "nodes"})
}

func (s *Store) loadNodeCategories(ctx context.Context, nodes []inventory.Node) error {
	if len(nodes) == 0 {
		return nil
	}
	ids := make([]any, 0, len(nodes))
	index := map[string]int{}
	for i, n := range nodes {
		ids = append(ids, n.ID)
		index[n.ID] = i
	}
	rows, err := s.db.QueryContext(ctx, `SELECT m.node_id,c.id,c.kind,c.name,c.shared FROM node_category_members m JOIN node_categories c ON c.id=m.category_id WHERE m.node_id IN (`+placeholders(len(ids))+`) ORDER BY c.kind,c.name,c.id`, ids...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var c inventory.NodeCategory
		if err = rows.Scan(&id, &c.ID, &c.Kind, &c.Name, &c.Shared); err != nil {
			return err
		}
		i := index[id]
		nodes[i].Categories = append(nodes[i].Categories, c)
	}
	return rows.Err()
}
