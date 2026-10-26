package main

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	localFilePrefix  = "/__local/"
	localFileTTL     = 30 * time.Minute
	localFileEntries = 128
)

// localFiles serves previews of files the backend has already authorized,
// by unguessable token, so the WebView streams them instead of receiving
// base64 copies over IPC. Arbitrary paths are never served.
type localFiles struct {
	mu      sync.Mutex
	entries map[string]localFile
	order   []string
}

type localFile struct {
	path    string
	mime    string
	expires time.Time
}

func newLocalFiles() *localFiles {
	return &localFiles{entries: map[string]localFile{}}
}

// register returns a URL for path, valid for localFileTTL.
func (l *localFiles) register(path, mime string) string {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	token := hex.EncodeToString(buf)
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	for len(l.order) > 0 {
		first := l.order[0]
		if entry, ok := l.entries[first]; ok && now.Before(entry.expires) && len(l.order) < localFileEntries {
			break
		}
		delete(l.entries, first)
		l.order = l.order[1:]
	}
	l.entries[token] = localFile{path: path, mime: mime, expires: now.Add(localFileTTL)}
	l.order = append(l.order, token)
	return localFilePrefix + token + "/" + url.PathEscape(filepath.Base(path))
}

func (l *localFiles) lookup(token string) (localFile, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	entry, ok := l.entries[token]
	if !ok || time.Now().After(entry.expires) {
		return localFile{}, false
	}
	return entry, true
}

func (l *localFiles) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.URL.Path, localFilePrefix) || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
		http.NotFound(w, r)
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, localFilePrefix)
	token, _, _ := strings.Cut(rest, "/")
	entry, ok := l.lookup(token)
	if !ok {
		http.NotFound(w, r)
		return
	}
	file, err := os.Open(entry.path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	if entry.mime != "" {
		w.Header().Set("Content-Type", entry.mime)
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if strings.HasPrefix(entry.mime, "image/svg") {
		// Never run script from previewed SVGs.
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	}
	http.ServeContent(w, r, filepath.Base(entry.path), info.ModTime(), file)
}
