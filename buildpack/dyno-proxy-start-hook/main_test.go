package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/BurntSushi/toml"
)

const xpJSON = `{
  "version": 2,
  "experiments": [
    {
      "appID": "app-a", "routeID": "exp-a",
      "url": "https://exp-a.herokuapp.com",
      "rules": [
        {"weight": 25, "traffic": "mirror", "methods": "get, post", "path": "/api"},
        {"traffic": "live", "header": "x-xp: agent-a", "query": "xp: a"}
      ]
    },
    {
      "routeID": "exp-off", "url": "https://off.herokuapp.com",
      "active": false, "rules": [{"traffic": "live", "path": "/off"}]
    },
    {
      "routeID": "exp-b", "url": "https://exp-b.herokuapp.com",
      "rules": [{"traffic": "live", "path": "/zero", "weight": 0}, {"traffic": "live", "header": {"x-xp": "b"}}]
    }
  ]
}`

func runHook(t *testing.T, project string, env map[string]string) (path, stdout, stderr string, err error) {
	t.Helper()
	dir := t.TempDir()
	path = filepath.Join(dir, "project.toml")
	if project != "" {
		if err := os.WriteFile(path, []byte(project), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	var out, errb bytes.Buffer
	err = run(dir, func(k string) string { return env[k] }, &out, &errb)
	return path, out.String(), errb.String(), err
}

func readRoutes(t *testing.T, path string) []map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := toml.Unmarshal(data, &doc); err != nil {
		t.Fatalf("project.toml does not parse: %v\n%s", err, data)
	}
	return tables(doc["routes"])
}

func TestConvertsXPToRoutes(t *testing.T) {
	path, _, stderr, err := runHook(t, "", map[string]string{"HEROKU_XP": xpJSON})
	if err != nil {
		t.Fatalf("run: %v\n%s", err, stderr)
	}
	routes := readRoutes(t, path)
	// exp-a: 1 path rule + 1 header/query rule; exp-off skipped; exp-b: zero skipped, 1 header rule.
	if len(routes) != 3 {
		t.Fatalf("want 3 routes, got %d: %v", len(routes), routes)
	}

	r := routes[0]
	if r["path"] != "/api" || r["to"] != "https://exp-a.herokuapp.com" || r["percentage"] != int64(25) ||
		r["mirror"] != true || r["routeID"] != "exp-a" || r["appID"] != "app-a" {
		t.Errorf("route 0 = %v", r)
	}
	if m := r["methods"].([]any); len(m) != 2 || m[0] != "GET" || m[1] != "POST" {
		t.Errorf("methods = %v", m)
	}
	if h := routes[1]["header"].(map[string]any); h["x-xp"] != "agent-a" {
		t.Errorf("header = %v", h)
	}
	if q := routes[1]["query"].(map[string]any); q["xp"] != "a" {
		t.Errorf("query = %v", q)
	}
	if _, ok := routes[1]["path"]; ok {
		t.Errorf("rule without a path should not set one: %v", routes[1])
	}
	if h := routes[2]["header"].(map[string]any); h["x-xp"] != "b" {
		t.Errorf("object header = %v", h)
	}
	for i := 1; i <= 2; i++ {
		if _, ok := routes[i]["percentage"]; ok {
			t.Errorf("rule without a weight should not set percentage: %v", routes[i])
		}
	}
}

func TestPreservesExistingContentAndIsIdempotent(t *testing.T) {
	project := "[[routes]]\npath = \"/mine\"\nto = \"https://mine.example.com\"\n"
	env := map[string]string{"HEROKU_XP": xpJSON}
	path, _, _, err := runHook(t, project, env)
	if err != nil {
		t.Fatal(err)
	}
	first, _ := os.ReadFile(path)
	if !strings.HasPrefix(string(first), project) {
		t.Errorf("existing content not preserved:\n%s", first)
	}
	if got := len(readRoutes(t, path)); got != 4 {
		t.Errorf("want 4 routes, got %d", got)
	}

	var out, errb bytes.Buffer
	if err := run(filepath.Dir(path), func(k string) string { return env[k] }, &out, &errb); err != nil {
		t.Fatal(err)
	}
	second, _ := os.ReadFile(path)
	if !bytes.Equal(first, second) {
		t.Errorf("second run changed the file:\n%s", second)
	}
	if !strings.Contains(out.String(), "up to date") {
		t.Errorf("stdout = %q", out.String())
	}
}

func TestRemovesBlockWhenXPUnset(t *testing.T) {
	project := "[[routes]]\npath = \"/mine\"\nto = \"https://mine.example.com\"\n"
	path, _, _, err := runHook(t, project, map[string]string{"HEROKU_XP": xpJSON})
	if err != nil {
		t.Fatal(err)
	}
	if err := run(filepath.Dir(path), func(string) string { return "" }, &bytes.Buffer{}, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != project {
		t.Errorf("block not removed:\n%s", got)
	}
}

func TestInvalidXPDoesNotFail(t *testing.T) {
	for name, xp := range map[string]string{
		"bad json":        "not json{",
		"missing url":     `{"experiments":[{"routeID":"x","rules":[{"traffic":"live","path":"/"}]}]}`,
		"no traffic":      `{"experiments":[{"routeID":"x","url":"https://x","rules":[{"path":"/","mirror":true}]}]}`,
		"unknown traffic": `{"experiments":[{"routeID":"x","url":"https://x","rules":[{"path":"/","traffic":"both"}]}]}`,
		"bad matcher":     `{"experiments":[{"routeID":"x","url":"https://x","rules":[{"traffic":"live","header":"nocolon"}]}]}`,
	} {
		t.Run(name, func(t *testing.T) {
			path, _, stderr, err := runHook(t, "", map[string]string{"HEROKU_XP": xp})
			if err != nil {
				t.Fatalf("run: %v", err)
			}
			if !strings.Contains(stderr, "ignoring HEROKU_XP") {
				t.Errorf("stderr = %q", stderr)
			}
			if got := readRoutes(t, path); len(got) != 0 {
				t.Errorf("want no routes, got %v", got)
			}
		})
	}
}

func TestInlineRoutesAreNormalized(t *testing.T) {
	project := "routes = [{ path = \"/mine\", to = \"https://mine.example.com\" }]\n"
	path, _, stderr, err := runHook(t, project, map[string]string{"HEROKU_XP": xpJSON})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if !strings.Contains(stderr, "rewrote the routes") {
		t.Errorf("stderr = %q", stderr)
	}
	if got := len(readRoutes(t, path)); got != 4 {
		t.Errorf("want 4 routes, got %d", got)
	}
}

func TestBrokenProjectTomlFails(t *testing.T) {
	if _, _, _, err := runHook(t, "[[routes\n", map[string]string{"HEROKU_XP": xpJSON}); err == nil {
		t.Fatal("want error for unparseable project.toml")
	}
}

func TestProjectTomlEnvOverride(t *testing.T) {
	dir := t.TempDir()
	custom := filepath.Join(dir, "custom.toml")
	err := run(dir, func(k string) string {
		return map[string]string{"HEROKU_XP": xpJSON, "PROJECT_TOML": "custom.toml"}[k]
	}, &bytes.Buffer{}, &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	if got := len(readRoutes(t, custom)); got != 3 {
		t.Errorf("want 3 routes, got %d", got)
	}
}

// `heroku xp --traffic mirror|live` is stored as rule.traffic and written as mirror = true (live omits it).
func TestTrafficMirrorAndLive(t *testing.T) {
	xp := `{"experiments":[
	  {"routeID":"m","url":"https://m.example.com","rules":[{"traffic":"mirror","weight":10,"methods":"GET"}]},
	  {"routeID":"l","url":"https://l.example.com","rules":[{"traffic":"live","weight":10,"methods":"GET"}]}
	]}`
	path, _, stderr, err := runHook(t, "", map[string]string{"HEROKU_XP": xp})
	if err != nil {
		t.Fatalf("run: %v\n%s", err, stderr)
	}
	routes := readRoutes(t, path)
	if len(routes) != 2 {
		t.Fatalf("want 2 routes, got %v", routes)
	}
	if routes[0]["mirror"] != true {
		t.Errorf("mirror experiment: mirror = %v, want true", routes[0]["mirror"])
	}
	if _, ok := routes[1]["mirror"]; ok {
		t.Errorf("live experiment must not be mirrored: %v", routes[1])
	}
}
