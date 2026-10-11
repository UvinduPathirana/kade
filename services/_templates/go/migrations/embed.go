// Package migrations embeds the goose SQL migrations; they run on start (MIGRATE_ON_START).
// Add a file with the next number: 00002_add_something.sql, with -- +goose Up / Down sections.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
