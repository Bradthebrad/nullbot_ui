package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
)

func TestActivityBatcherMergesDeltasAndKeepsOrder(t *testing.T) {
	var mu sync.Mutex
	var batches [][]nullbot.ActivityRecord
	b := newActivityBatcher(func(batch []nullbot.ActivityRecord) {
		mu.Lock()
		batches = append(batches, batch)
		mu.Unlock()
	})
	delta := func(seq uint64, text string) nullbot.ActivityRecord {
		return nullbot.ActivityRecord{Seq: seq, Kind: "on_llm_new_token", Status: "response delta", RunID: "r1", AgentID: "main", Detail: text}
	}
	for i, word := range []string{"Hel", "lo", " wor", "ld"} {
		b.add(delta(uint64(i+1), word))
	}
	b.add(nullbot.ActivityRecord{Seq: 5, Status: "tool start", Tool: "web_search"})
	b.add(delta(6, "after"))
	time.Sleep(3 * streamFlushInterval)
	mu.Lock()
	defer mu.Unlock()
	if len(batches) != 2 {
		t.Fatalf("batches = %d: %#v", len(batches), batches)
	}
	first := batches[0]
	if len(first) != 2 || first[0].Detail != "Hello world" || first[0].Seq != 4 || first[1].Tool != "web_search" {
		t.Fatalf("first batch = %#v", first)
	}
	if len(batches[1]) != 1 || batches[1][0].Detail != "after" {
		t.Fatalf("second batch = %#v", batches[1])
	}
}

func TestLocalFilesServesOnlyRegisteredTokens(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "chart.png")
	if err := os.WriteFile(path, []byte("png-bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	files := newLocalFiles()
	url := files.register(path, "image/png")
	rec := httptest.NewRecorder()
	files.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
	if rec.Code != http.StatusOK || rec.Body.String() != "png-bytes" || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("served %d %q %q", rec.Code, rec.Body.String(), rec.Header().Get("Content-Type"))
	}
	for _, bad := range []string{"/__local/deadbeef/chart.png", "/__local/../../etc/passwd", "/index.html", "/__local/" + filepath.ToSlash(path)} {
		rec := httptest.NewRecorder()
		files.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://wails.localhost"+strings.ReplaceAll(bad, " ", "%20"), nil))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s served with %d", bad, rec.Code)
		}
	}
}

func TestPreviewStreamsImagesInsteadOfBase64(t *testing.T) {
	c := permissionConfig(t, "read-only")
	app := permissionApp(c)
	path := filepath.Join(c.WorkspaceDir, "pic.png")
	if err := os.WriteFile(path, []byte("\x89PNG"), 0600); err != nil {
		t.Fatal(err)
	}
	preview, err := app.PreviewFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(preview.URL, localFilePrefix) || strings.HasPrefix(preview.DataURL, "data:") {
		t.Fatalf("preview = %#v", preview)
	}
}

func TestOpenExternalAllowsOnlyWebAndMail(t *testing.T) {
	app := &App{}
	for _, bad := range []string{"file:///C:/Windows/system32/calc.exe", "javascript:alert(1)", "ms-settings:privacy", "C:\\\\evil.exe", "https://"} {
		if err := app.OpenExternal(bad); err == nil || strings.Contains(err.Error(), "not ready") {
			t.Fatalf("%q was not rejected: %v", bad, err)
		}
	}
	for _, good := range []string{"https://example.com/a?b=c", "http://localhost:8080", "mailto:team@example.com"} {
		if err := app.OpenExternal(good); err == nil || !strings.Contains(err.Error(), "not ready") {
			t.Fatalf("%q should pass validation: %v", good, err)
		}
	}
}

func TestOpenPathStaysInsideProjects(t *testing.T) {
	c := permissionConfig(t, "read-only")
	app := permissionApp(c)
	outside := filepath.Join(t.TempDir(), "secret.txt")
	if err := os.WriteFile(outside, []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := app.OpenPath(outside); err == nil {
		t.Fatal("opened a file outside configured projects")
	}
	if err := app.RevealPath(outside); err == nil {
		t.Fatal("revealed a file outside configured projects")
	}
}

// Usage filters name days on this computer's calendar, like the buckets.
func TestUsageDatesAreLocalDays(t *testing.T) {
	start := parseDate("2026-10-26", false)
	end := parseDate("2026-10-26", true)
	if start.Location() != time.Local || start.Hour() != 0 || end.Day() != 26 || end.Hour() != 23 {
		t.Fatalf("start %v end %v", start, end)
	}
	if got := parseDate("2026-10-26T09:00:00+02:00", false); got.UTC().Hour() != 7 {
		t.Fatalf("RFC3339 offset lost: %v", got)
	}
}

// Session search goes through the shared history search: titles come from
// the first request, and each session carries its first match and count.
func TestSearchSessionsUsesHistorySearch(t *testing.T) {
	c := permissionConfig(t, "read-only")
	app := permissionApp(c)
	dir := filepath.Join(c.AppDir, "history")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	write := func(name string, lines ...string) {
		if err := os.WriteFile(filepath.Join(dir, name+".jsonl"), []byte(strings.Join(lines, "\n")+"\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("a", `{"message":{"role":"user","content":"Reconcile invoices","time":"2026-10-20T09:00:00Z"}}`, `{"message":{"role":"assistant","content":"Three invoices are off: INV-104","time":"2026-10-20T09:01:00Z"}}`)
	write("b", `{"message":{"role":"user","content":"Weather?","time":"2026-10-21T09:00:00Z"}}`)
	got, err := app.SearchSessions("invoices")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].SessionID != "a" || got[0].Title != "Reconcile invoices" || got[0].Matches != 2 || !strings.Contains(got[0].Snippet, "invoices") {
		t.Fatalf("search = %+v", got)
	}
	users, err := app.SearchSessionsWith(nullbot.HistoryQuery{Roles: []string{"user"}, Text: "weather"})
	if err != nil || len(users) != 1 || users[0].SessionID != "b" {
		t.Fatalf("filtered = %+v, %v", users, err)
	}
	entries, err := app.SessionEntries("a", true)
	if err != nil || len(entries) != 2 || entries[1].Message.Content != "Three invoices are off: INV-104" {
		t.Fatalf("entries = %+v, %v", entries, err)
	}
}
