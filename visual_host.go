package main

import (
	"bytes"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// How visuals are shown safely.
//
// A visual runs its own scripts. Its page is handed to a sandboxed frame as
// srcdoc, so the document has no address of its own (about:srcdoc) and an
// opaque origin: it can't touch the app's page, and the desktop app refuses
// calls into Go from anything but the app's own address. The files the page
// loads (pictures, styles, scripts) come from /__vis/<token>/ through the
// app's asset handler, never over the network.
//
// Everything under /__vis/ is sent with a policy that stops it running as a
// document: a page that navigates its frame to one of those addresses gets
// an inert page, and the app is told so it can show that page the safe way.
// Without allow_network a visual's own policy also limits it to its files.

//go:embed visualassets
var visualAssets embed.FS

const (
	visualPrefix     = "/__vis/"
	visualAssetsPath = "/__nullbot/"
	visualSiteLimit  = 256
	maxVisualPage    = 10 << 20
)

var visualAssetTypes = map[string]string{
	"bridge.js":    "text/javascript; charset=utf-8",
	"image.js":     "text/javascript; charset=utf-8",
	"chart.js":     "text/javascript; charset=utf-8",
	"drawio.js":    "text/javascript; charset=utf-8",
	"host.css":     "text/css; charset=utf-8",
	"lib/chart.js": "text/javascript; charset=utf-8",
}

// Types are set here rather than from the system: Windows can map .js to
// text/plain in the registry, which stops module scripts loading.
var visualFileTypes = map[string]string{
	".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".xhtml": "application/xhtml+xml",
	".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".cjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8", ".json": "application/json", ".map": "application/json", ".webmanifest": "application/manifest+json",
	".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".jfif": "image/jpeg", ".gif": "image/gif",
	".webp": "image/webp", ".avif": "image/avif", ".bmp": "image/bmp", ".ico": "image/x-icon", ".apng": "image/apng",
	".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
	".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".mp4": "video/mp4", ".webm": "video/webm",
	".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".xml": "application/xml",
	".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".drawio": "application/xml",
}

type visualSites struct {
	mu       sync.Mutex
	sites    map[string]*visualSite
	byVisual map[string]string
	order    []string
	// canRead authorizes a project file for reading and returns its real path.
	canRead func(path string) (string, error)
	// navigated is told when a visual's frame tried to open a page itself.
	navigated func(visualID, page string)
}

type visualSite struct {
	visualID string
	// root is a project folder served as the page's site; empty for none.
	root string
	// dataDir is the visual's own folder.
	dataDir string
	network bool
}

func newVisualSites(canRead func(string) (string, error), navigated func(string, string)) *visualSites {
	return &visualSites{canRead: canRead, navigated: navigated, sites: map[string]*visualSite{}, byVisual: map[string]string{}}
}

// register serves site and returns its token. A visual keeps its token
// while the app runs.
func (v *visualSites) register(site *visualSite) (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	token := v.byVisual[site.visualID]
	if token == "" {
		buf := make([]byte, 16)
		if _, err := rand.Read(buf); err != nil {
			return "", err
		}
		token = hex.EncodeToString(buf)
		v.byVisual[site.visualID] = token
		v.order = append(v.order, token)
		for len(v.order) > visualSiteLimit {
			old := v.order[0]
			v.order = v.order[1:]
			if gone := v.sites[old]; gone != nil {
				delete(v.byVisual, gone.visualID)
			}
			delete(v.sites, old)
		}
	}
	v.sites[token] = site
	return token, nil
}

func (v *visualSites) forget(visualID string) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if token := v.byVisual[visualID]; token != "" {
		delete(v.sites, token)
		delete(v.byVisual, visualID)
	}
}

var visualTokenPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

// handles reports whether path is one this handler serves.
func (v *visualSites) handles(p string) bool {
	return strings.HasPrefix(p, visualPrefix) || strings.HasPrefix(p, visualAssetsPath)
}

func (v *visualSites) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	inertHeaders(w)
	if name, ok := strings.CutPrefix(r.URL.Path, visualAssetsPath); ok {
		serveVisualAsset(w, r, name)
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, visualPrefix)
	token, rel, _ := strings.Cut(rest, "/")
	if !visualTokenPattern.MatchString(token) {
		http.NotFound(w, r)
		return
	}
	v.mu.Lock()
	site := v.sites[token]
	v.mu.Unlock()
	if site == nil {
		http.NotFound(w, r)
		return
	}
	clean := strings.TrimPrefix(path.Clean("/"+rel), "/")
	if strings.ContainsRune(clean, 0) {
		http.NotFound(w, r)
		return
	}
	file, err := v.resolve(site, clean)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if isPageFile(file) {
		// A page asked for over HTTP is a frame navigating itself (pages
		// are always handed over as srcdoc). Answer with an inert page and
		// let the app show the real one.
		dest := r.Header.Get("Sec-Fetch-Dest")
		if dest != "" && dest != "document" && dest != "iframe" && dest != "frame" {
			http.NotFound(w, r)
			return
		}
		if v.navigated != nil && site.root != "" {
			if page, err := filepath.Rel(site.root, file); err == nil && !strings.HasPrefix(page, "..") {
				v.navigated(site.visualID, filepath.ToSlash(page))
			}
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, `<!doctype html><meta charset="utf-8"><body style="font:13px system-ui,sans-serif;color:#7c838c;padding:16px">Opening…</body>`)
		return
	}
	serveVisualFile(w, r, file, site, token)
}

// inertHeaders: nothing served here runs as a document, and nothing here
// is shared with other sites' requests' referrers.
func inertHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; sandbox")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "no-store")
	h.Set("Referrer-Policy", "no-referrer")
	// The visual's origin is opaque, so its module scripts and fetches of
	// its own files are cross-origin requests.
	h.Set("Access-Control-Allow-Origin", "*")
}

func isPageFile(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".html", ".htm", ".xhtml":
		return true
	}
	return false
}

// resolve maps a URL path to a file the visual may load.
func (v *visualSites) resolve(site *visualSite, rel string) (string, error) {
	if site.root != "" {
		full := filepath.Join(site.root, filepath.FromSlash(rel))
		if !pathInside(site.root, full) {
			return "", errors.New("outside the site")
		}
		resolved, err := v.canRead(full)
		if err != nil {
			return "", err
		}
		info, err := os.Stat(resolved)
		if err != nil {
			return "", err
		}
		if info.IsDir() {
			return v.canRead(filepath.Join(full, "index.html"))
		}
		return resolved, nil
	}
	// The visual's own folder: pictures and content, never its records.
	name := filepath.FromSlash(rel)
	if name == "" || name != filepath.Base(name) || name == "visual.json" || name == "events.jsonl" || strings.HasSuffix(name, ".tmp") {
		return "", errors.New("not served")
	}
	file := filepath.Join(site.dataDir, name)
	info, err := os.Lstat(file)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("not a plain file")
	}
	return file, nil
}

func pathInside(root, p string) bool {
	rel, err := filepath.Rel(root, p)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

func serveVisualAsset(w http.ResponseWriter, r *http.Request, name string) {
	mime, ok := visualAssetTypes[name]
	if !ok {
		http.NotFound(w, r)
		return
	}
	data, err := fs.ReadFile(visualAssets, "visualassets/"+name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "max-age=3600")
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}

var cssRootURL = regexp.MustCompile(`(url\(\s*["']?)/([^/"')][^"')]*)`)

// rewriteRootURLs points site-root URLs (/assets/app.js) into the visual's
// site. NullBot's own libraries keep their address.
func rewriteRootURLs(data []byte, pattern *regexp.Regexp, token string) []byte {
	return pattern.ReplaceAllFunc(data, func(match []byte) []byte {
		groups := pattern.FindSubmatch(match)
		rest := string(groups[2])
		if strings.HasPrefix(rest, strings.TrimPrefix(visualAssetsPath, "/")) || strings.HasPrefix(rest, strings.TrimPrefix(visualPrefix, "/")) {
			return match
		}
		return []byte(string(groups[1]) + visualPrefix + token + "/" + rest)
	})
}

func serveVisualFile(w http.ResponseWriter, r *http.Request, file string, site *visualSite, token string) {
	f, err := os.Open(file)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	mime := visualFileTypes[strings.ToLower(filepath.Ext(file))]
	if mime == "" {
		mime = "application/octet-stream"
	}
	w.Header().Set("Content-Type", mime)
	if site.root != "" && strings.HasPrefix(mime, "text/css") && info.Size() < maxVisualPage {
		// Site-root URLs in a stylesheet point into the visual's site.
		data, err := io.ReadAll(io.LimitReader(f, maxVisualPage))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		data = rewriteRootURLs(data, cssRootURL, token)
		http.ServeContent(w, r, filepath.Base(file), info.ModTime(), bytes.NewReader(data))
		return
	}
	http.ServeContent(w, r, filepath.Base(file), info.ModTime(), f)
}

var (
	headOpenTag = regexp.MustCompile(`(?is)<head(\s[^>]*)?>`)
	htmlOpenTag = regexp.MustCompile(`(?is)<html(\s[^>]*)?>`)
	doctypeTag  = regexp.MustCompile(`(?is)^\s*<!doctype[^>]*>`)
	// Chart.js from a CDN, which a visual without the internet can't reach.
	chartCDNScript = regexp.MustCompile(`(?i)(<script[^>]*\ssrc\s*=\s*["'])https?://[^"']*chart(?:\.js|\.umd)[^"']*(["'])`)
	// Site-root URLs in attributes, such as src="/assets/app.js".
	rootURLAttr      = regexp.MustCompile(`(?i)(\s(?:src|href|action|poster|data)\s*=\s*["'])/([^/"'][^"']*)`)
	scriptTagPattern = regexp.MustCompile(`(?i)<script\s[^>]*\bsrc\s*=[^>]*>`)
	scriptSrcPattern = regexp.MustCompile(`\bsrc\s*=\s*["']?([^"'\s>]+)`)
	originPattern    = regexp.MustCompile(`^(https?|wails)://[A-Za-z0-9.\-]+(:\d{1,5})?$`)
)

// visualDocument prepares a page for the visual's frame: its base address
// points into the visual's files, its policy limits what it can load, and
// the bridge runs before anything else.
func visualDocument(page []byte, origin, token, dir, name string, site *visualSite) (string, error) {
	if !originPattern.MatchString(origin) {
		return "", fmt.Errorf("unexpected app address %q", origin)
	}
	bridge, err := fs.ReadFile(visualAssets, "visualassets/bridge.js")
	if err != nil {
		return "", err
	}
	files := origin + visualPrefix + token + "/"
	base := files
	if dir = strings.Trim(dir, "/"); dir != "" && dir != "." {
		base += (&urlPath{dir}).String() + "/"
	}
	libs := origin + visualAssetsPath
	csp := "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; form-action 'none'; base-uri " + files
	if !site.network {
		local := files + " " + libs + " data: blob:"
		csp = strings.Join([]string{
			"default-src " + local,
			"script-src " + local + " 'unsafe-inline' 'unsafe-eval'",
			"style-src " + local + " 'unsafe-inline'",
			"img-src " + local,
			"font-src " + local,
			"media-src " + local,
			"connect-src " + local,
			"frame-src " + local,
			"worker-src " + local,
			"form-action 'none'",
			"base-uri " + files,
		}, "; ")
		page = chartCDNScript.ReplaceAll(page, []byte("${1}"+libs+"lib/chart.js${2}"))
	}
	if site.root != "" {
		page = rewriteRootURLs(page, rootURLAttr, token)
	}
	// Scripts from the visual's files are fetched with CORS, so their errors
	// reach the bridge with a message instead of a bare "Script error."
	page = scriptTagPattern.ReplaceAllFunc(page, func(tag []byte) []byte {
		lower := bytes.ToLower(tag)
		if bytes.Contains(lower, []byte("crossorigin")) {
			return tag
		}
		if m := scriptSrcPattern.FindSubmatch(lower); m != nil && site.network && (bytes.HasPrefix(m[1], []byte("http:")) || bytes.HasPrefix(m[1], []byte("https:")) || bytes.HasPrefix(m[1], []byte("//"))) {
			return tag // a CDN may not send CORS headers
		}
		return append([]byte(`<script crossorigin="anonymous"`), tag[len("<script"):]...)
	})
	head := fmt.Sprintf(`<base href="%s"><meta http-equiv="Content-Security-Policy" content="%s"><meta name="nullbot-page" content="%s"><script>%s</script>`, html.EscapeString(base), html.EscapeString(csp), html.EscapeString(name), bridge)
	at := 0
	if loc := headOpenTag.FindIndex(page); loc != nil {
		at = loc[1]
	} else if loc := htmlOpenTag.FindIndex(page); loc != nil {
		at = loc[1]
	} else if loc := doctypeTag.FindIndex(page); loc != nil {
		at = loc[1]
	}
	var b strings.Builder
	b.Grow(len(page) + len(head))
	b.Write(page[:at])
	b.WriteString(head)
	b.Write(page[at:])
	return b.String(), nil
}

type urlPath struct{ p string }

func (u *urlPath) String() string {
	parts := strings.Split(u.p, "/")
	for i, part := range parts {
		parts[i] = pathEscape(part)
	}
	return strings.Join(parts, "/")
}

func pathEscape(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || strings.IndexByte("-._~!$&'()*+,;=:@", c) >= 0 {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// hostPage is a page NullBot builds around a picture, chart or diagram.
func hostPage(title, kind, body string, scripts ...string) []byte {
	var b strings.Builder
	b.WriteString(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/__nullbot/host.css"><title>`)
	b.WriteString(html.EscapeString(title))
	fmt.Fprintf(&b, `</title></head><body class="kind-%s">`, kind)
	b.WriteString(body)
	for _, src := range scripts {
		fmt.Fprintf(&b, `<script src="%s"></script>`, src)
	}
	b.WriteString("</body></html>")
	return []byte(b.String())
}

// jsonScript embeds data for a page script; < is escaped so the data can't
// end the script element.
func jsonScript(id string, data any) (string, error) {
	raw, err := json.Marshal(data)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(`<script type="application/json" id="%s">%s</script>`, id, strings.ReplaceAll(string(raw), "<", `<`)), nil
}

var xmlPrologPattern = regexp.MustCompile(`(?is)^\s*(<\?xml[^>]*\?>\s*)?(<!--.*?-->\s*)*(<!DOCTYPE[^>]*(\[[^\]]*\])?\s*>\s*)?`)

// inlineSVG prepares SVG markup for an HTML page.
func inlineSVG(svg string) string {
	return xmlPrologPattern.ReplaceAllString(svg, "")
}

// appAssets serves the app's own files, then previews and visuals.
type appAssets struct {
	local   *localFiles
	visuals *visualSites
}

func (h appAssets) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.visuals != nil && h.visuals.handles(r.URL.Path) {
		h.visuals.ServeHTTP(w, r)
		return
	}
	h.local.ServeHTTP(w, r)
}
