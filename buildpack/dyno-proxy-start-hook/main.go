// Command dyno-proxy-start-hook is the XP startup hook.
//
// Before it starts the load balancer, dyno-proxy (`dyno-proxy run` and
// `dyno-proxy background`) execs `<dir>/dyno-proxy-start-hook`, where <dir> is
// the dyno-proxy executable's directory (its "startup hook"). This program is
// that hook; the buildpack installs it there (see buildpack/bin/build and
// buildpack/bin/compile). It runs on every boot.
//
// It converts the HEROKU_XP config var (written by the `heroku xp` commands)
// into [[routes]] in project.toml (./project.toml, or $PROJECT_TOML):
//
//  1. The routes it writes live in a managed block between marker comments,
//     which is stripped and rewritten on every run. Everything outside the
//     markers is left as is.
//  2. Each active experiment rule becomes one route
//     forwarding to the experiment's url. Inactive
//     experiments and rules with weight 0 are skipped. A rule's traffic is
//     "mirror" (staging still responds; the route is mirrored) or "live" (the
//     experiment responds) and is required.
//  3. If HEROKU_XP is unset or empty, the managed block is dropped.
//
// A broken HEROKU_XP does not fail the hook: the block is dropped, a warning is
// printed, and the app keeps serving staging. The hook exits non-zero only when
// project.toml itself cannot be read, parsed or written. Routes declared as an
// inline array or a table are rewritten as [[routes]] tables so the XP routes
// can be appended.
//
// dyno-proxy watches project.toml and reloads when it changes, so the file is
// only written when its content changes, and always in place (os.WriteFile; a
// rename would drop the watch).
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/BurntSushi/toml"
)

func main() {
	fmt.Println("running dyno-proxy-start-hook")

	if err := run(".", os.Getenv, os.Stdout, os.Stderr); err != nil {
		fmt.Fprintf(os.Stderr, " !     dyno-proxy-start-hook: %v\n", err)
		os.Exit(1)
	}
}

const (
	beginMarker = "# >>> heroku-xp (managed by dyno-proxy-start-hook) >>>"
	endMarker   = "# <<< heroku-xp <<<"
)

// run is the whole hook. A relative project.toml is resolved against dir.
func run(dir string, getenv func(string) string, stdout, stderr io.Writer) error {
	path := getenv("PROJECT_TOML")
	if path == "" {
		path = "project.toml"
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(dir, path)
	}

	existing, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("reading %s: %w", path, err)
	}
	remainder := stripManagedBlock(existing)
	if len(bytes.TrimSpace(remainder)) > 0 {
		if err := toml.Unmarshal(remainder, new(map[string]any)); err != nil {
			return fmt.Errorf("parsing %s: %w", path, err)
		}
	}

	routes, err := routesFromXP(getenv("HEROKU_XP"))
	if err != nil {
		fmt.Fprintf(stderr, "dyno-proxy-start-hook: warning: ignoring HEROKU_XP: %v\n", err)
		routes = nil
	}

	if len(routes) == 0 {
		if _, err := writeIfChanged(path, existing, remainder); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "dyno-proxy-start-hook: no XP routes to write to %s\n", path)
		return nil
	}

	block, err := renderBlock(routes)
	if err != nil {
		return fmt.Errorf("rendering routes block: %w", err)
	}
	out := withBlock(string(remainder), block)

	// The block is appended as [[routes]]; a project.toml that declares routes
	// as an inline array or a table cannot take it. Rewrite the user's routes
	// as [[routes]] tables instead, once; later runs find them already so.
	if err := toml.Unmarshal([]byte(out), new(map[string]any)); err != nil {
		normalized, nerr := normalizeRoutes(remainder)
		if nerr != nil {
			return fmt.Errorf("%s declares routes in a form the XP routes cannot be added to: %w", path, nerr)
		}
		out = withBlock(normalized, block)
		if err := toml.Unmarshal([]byte(out), new(map[string]any)); err != nil {
			return fmt.Errorf("%s declares routes in a form the XP routes cannot be added to: %w", path, err)
		}
		fmt.Fprintf(stderr, "dyno-proxy-start-hook: warning: rewrote the routes in %s as [[routes]] tables so the XP routes can be added; comments and formatting there were not kept\n", path)
	}

	wrote, err := writeIfChanged(path, existing, []byte(out))
	if err != nil {
		return err
	}
	if wrote {
		fmt.Fprintf(stdout, "dyno-proxy-start-hook: wrote %d XP route(s) to %s\n", len(routes), path)
	} else {
		fmt.Fprintf(stdout, "dyno-proxy-start-hook: the %d XP route(s) in %s are up to date\n", len(routes), path)
	}
	return nil
}

// withBlock appends block to rest. A blank line separates the block from prior
// content, and a trailing newline terminates the file.
func withBlock(rest, block string) string {
	if strings.TrimSpace(rest) == "" {
		return block + "\n"
	}
	return strings.TrimRight(rest, "\n") + "\n\n" + block + "\n"
}

// writeIfChanged writes want to path in place, unless it already holds exactly
// that content (an unchanged file must not trigger a dyno-proxy reload).
func writeIfChanged(path string, have, want []byte) (bool, error) {
	if bytes.Equal(have, want) {
		return false, nil
	}
	if err := os.WriteFile(path, want, 0o644); err != nil {
		return false, fmt.Errorf("writing %s: %w", path, err)
	}
	return true, nil
}

// stripManagedBlock removes the managed block (from the begin-marker line
// through the end-marker line, or to EOF if the end marker is missing). Data
// without a begin marker is returned unchanged.
func stripManagedBlock(data []byte) []byte {
	s := string(data)
	start := markerLine(s, beginMarker)
	if start < 0 {
		return data
	}
	rest := s[:start]
	if end := markerLine(s[start:], endMarker); end >= 0 {
		after := s[start+end+len(endMarker):]
		rest += strings.TrimPrefix(after, "\n")
	}
	rest = strings.TrimRight(rest, "\n")
	if rest != "" {
		rest += "\n"
	}
	return []byte(rest)
}

// markerLine returns the offset of the first line of s that is exactly
// marker, or -1.
func markerLine(s, marker string) int {
	for off := 0; off < len(s); {
		line, _, _ := strings.Cut(s[off:], "\n")
		if line == marker {
			return off
		}
		off += len(line) + 1
	}
	return -1
}

// normalizeRoutes re-encodes a project.toml whose routes are an inline array
// or a single table, so that routes is an array of tables that a [[routes]]
// block can extend.
func normalizeRoutes(data []byte) (string, error) {
	var doc map[string]any
	if err := toml.Unmarshal(data, &doc); err != nil {
		return "", err
	}
	if routes := tables(doc["routes"]); len(routes) > 0 {
		doc["routes"] = routes
	} else {
		delete(doc, "routes")
	}
	var buf bytes.Buffer
	if err := toml.NewEncoder(&buf).Encode(doc); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// tables returns v (a decoded TOML value) as a list of tables: a single table,
// an array of tables, or the tables in an inline array.
func tables(v any) []map[string]any {
	switch t := v.(type) {
	case map[string]any:
		return []map[string]any{t}
	case []map[string]any:
		return t
	case []any:
		var out []map[string]any
		for _, e := range t {
			if m, ok := e.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	}
	return nil
}

// ----- HEROKU_XP parsing -----

type xpConfig struct {
	Experiments []xpExperiment `json:"experiments"`
}

type xpExperiment struct {
	AppID   string   `json:"appID"`
	RouteID string   `json:"routeID"`
	URL     string   `json:"url"`
	Rules   []xpRule `json:"rules"`
	Active  *bool    `json:"active,omitempty"`
}

type xpRule struct {
	Traffic string  `json:"traffic"`
	Weight  *int    `json:"weight,omitempty"`
	Path    string  `json:"path,omitempty"`
	Methods string  `json:"methods,omitempty"` // one or more, comma-separated
	Header  kvMatch `json:"header,omitempty"`
	Query   kvMatch `json:"query,omitempty"`
	Body    kvMatch `json:"body,omitempty"`
}

// kvMatch is a header/query/body matcher. The CLI writes a single "key: value"
// string; a JSON object of key to value is accepted too.
type kvMatch map[string]string

func (m *kvMatch) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		k, v, ok := strings.Cut(s, ":")
		if k = strings.TrimSpace(k); !ok || k == "" {
			return fmt.Errorf("invalid matcher %q (want \"key: value\")", s)
		}
		*m = kvMatch{k: strings.TrimSpace(v)}
		return nil
	}
	var obj map[string]string
	if err := json.Unmarshal(data, &obj); err != nil {
		return fmt.Errorf("matcher must be a \"key: value\" string or an object: %w", err)
	}
	*m = obj
	return nil
}

// ----- TOML shapes emitted into project.toml (marshalled by BurntSushi) -----
//
// Keys match dyno-proxy's route schema.

type document struct {
	Routes []route `toml:"routes"`
}

type route struct {
	Path       string            `toml:"path,omitempty"`
	To         string            `toml:"to"`
	Methods    []string          `toml:"methods,omitempty"`
	Percentage int               `toml:"percentage,omitempty"`
	ID         string            `toml:"routeID,omitempty"`
	AppID      string            `toml:"appID,omitempty"`
	Mirror     bool              `toml:"mirror,omitempty"`
	Header     map[string]string `toml:"header,omitempty"`
	Query      map[string]string `toml:"query,omitempty"`
	Body       map[string]string `toml:"body,omitempty"`
}

// routesFromXP converts the HEROKU_XP JSON into routes. Empty input yields no
// routes.
func routesFromXP(raw string) ([]route, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var cfg xpConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}

	var routes []route
	for _, exp := range cfg.Experiments {
		if exp.Active != nil && !*exp.Active {
			continue
		}
		if exp.URL == "" {
			return nil, fmt.Errorf("experiment %q is missing url", exp.RouteID)
		}
		for i, rule := range exp.Rules {
			if rule.Weight != nil && *rule.Weight == 0 {
				continue
			}
			if rule.Traffic != "mirror" && rule.Traffic != "live" {
				return nil, fmt.Errorf("experiment %q rule %d has traffic %q (want \"mirror\" or \"live\")", exp.RouteID, i, rule.Traffic)
			}
			var methods []string
			for _, m := range splitList(rule.Methods) {
				methods = append(methods, strings.ToUpper(m))
			}
			pct := 0
			if rule.Weight != nil && *rule.Weight > 0 {
				pct = *rule.Weight
			}

			routes = append(routes, route{
				Path:       rule.Path,
				To:         exp.URL,
				Methods:    methods,
				Percentage: pct,
				ID:         exp.RouteID,
				AppID:      exp.AppID,
				Mirror:     rule.Traffic == "mirror",
				Header:     rule.Header,
				Query:      rule.Query,
				Body:       rule.Body,
			})
		}
	}
	return routes, nil
}

// splitList splits a comma-separated list, trimming items and dropping empty
// ones.
func splitList(s string) []string {
	var out []string
	for _, item := range strings.Split(s, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

// renderBlock marshals the managed [[routes]] block, wrapped in its marker
// lines.
func renderBlock(routes []route) (string, error) {
	var b strings.Builder
	if err := toml.NewEncoder(&b).Encode(document{Routes: routes}); err != nil {
		return "", err
	}
	return beginMarker + "\n" + strings.TrimRight(b.String(), "\n") + "\n" + endMarker, nil
}
