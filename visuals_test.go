package main

import (
	"bytes"
	"compress/flate"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
	tcagent "github.com/Bradthebrad/tinychain/agent"
)

const sampleDiagram = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="api" value="API &lt;b&gt;server&lt;/b&gt;" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>
<mxCell id="db" value="Database" style="shape=cylinder3;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="260" y="30" width="80" height="80" as="geometry"/></mxCell>
<mxCell id="grp" value="Group" style="swimlane;" vertex="1" parent="1"><mxGeometry x="40" y="160" width="200" height="120" as="geometry"/></mxCell>
<mxCell id="inner" value="Worker" style="ellipse;" vertex="1" parent="grp"><mxGeometry x="20" y="40" width="80" height="50" as="geometry"/></mxCell>
<mxCell id="e1" value="reads" style="edgeStyle=orthogonalEdgeStyle;endArrow=classic;" edge="1" parent="1" source="api" target="db"><mxGeometry relative="1" as="geometry"/></mxCell>
<UserObject label="Queue" id="q"><mxCell style="rhombus;" vertex="1" parent="1"><mxGeometry x="300" y="180" width="60" height="60" as="geometry"/></mxCell></UserObject>
</root></mxGraphModel>`

func compressDrawio(t *testing.T, xml string) string {
	t.Helper()
	var buf bytes.Buffer
	w, _ := flate.NewWriter(&buf, flate.DefaultCompression)
	w.Write([]byte(url.PathEscape(xml)))
	w.Close()
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestDrawioRendersShapesTextAndConnectors(t *testing.T) {
	file := `<mxfile><diagram name="Overview">` + compressDrawio(t, sampleDiagram) + `</diagram><diagram name="Plain">` + sampleDiagram + `</diagram></mxfile>`
	pages, err := drawioPages([]byte(file))
	if err != nil {
		t.Fatal(err)
	}
	if len(pages) != 2 || pages[0].Name != "Overview" || pages[1].Name != "Plain" {
		t.Fatalf("pages: %+v", pages)
	}
	svg := pages[0].SVG
	for _, want := range []string{
		`data-cell-id="api" data-label="API server"`, `fill="#dae8fc"`, `rx="9"`,
		`data-cell-id="db"`, `<path d="M260`,
		`data-cell-id="inner"`, `<ellipse cx="100" cy="225"`, // inside the group, offset by it
		`data-cell-id="q" data-label="Queue"`, `<polygon`,
		`data-cell-id="e1" data-label="reads"`, `marker-end="url(#arrow-000000)"`,
		`>Database</tspan>`,
	} {
		if !strings.Contains(svg, want) {
			t.Errorf("SVG lacks %s", want)
		}
	}
	if pages[1].SVG != svg {
		t.Error("compressed and plain pages differ")
	}
	if strings.Contains(svg, "<b>") {
		t.Error("HTML label markup leaked into the SVG")
	}
	for _, bad := range []string{"<html/>", "<mxfile></mxfile>", "not xml"} {
		if _, err := drawioPages([]byte(bad)); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	// Text that tries to break out of the SVG stays text.
	evil := strings.Replace(sampleDiagram, `value="Database"`, `value="&lt;/svg&gt;&lt;script&gt;x()&lt;/script&gt;"`, 1)
	pages, _ = drawioPages([]byte(evil))
	if strings.Contains(pages[0].SVG, "<script>") {
		t.Fatal("label markup became script")
	}
}

func TestVisualDocumentRunsTheBridgeFirstAndLimitsLoads(t *testing.T) {
	site := &visualSite{visualID: "vis-x", root: "/p", dataDir: "/d"}
	page := []byte(`<!doctype html><html><head><title>t</title><script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script><link href="/assets/app.css" rel="stylesheet"></head><body><img src="/__nullbot/lib/chart.js"><a href="//cdn.example/x">x</a></body></html>`)
	doc, err := visualDocument(page, "http://wails.localhost", "0123456789abcdef0123456789abcdef", "web/app", "web/app/index.html", site)
	if err != nil {
		t.Fatal(err)
	}
	head := doc[strings.Index(doc, "<head>")+6:]
	if !strings.HasPrefix(head, `<base href="http://wails.localhost/__vis/0123456789abcdef0123456789abcdef/web/app/">`) {
		t.Fatalf("base not first: %.200s", head)
	}
	if strings.Index(doc, "window.nullbot") > strings.Index(doc, "<title>") {
		t.Fatal("bridge runs after the page's own content")
	}
	for _, want := range []string{
		"connect-src http://wails.localhost/__vis/0123456789abcdef0123456789abcdef/ http://wails.localhost/__nullbot/ data: blob:",
		`src="http://wails.localhost/__nullbot/lib/chart.js"`,
		`href="/__vis/0123456789abcdef0123456789abcdef/assets/app.css"`,
		`<img src="/__nullbot/lib/chart.js">`,
		`href="//cdn.example/x"`,
		"form-action &#39;none&#39;",
	} {
		if !strings.Contains(doc, want) {
			t.Errorf("document lacks %s", want)
		}
	}
	site.network = true
	doc, _ = visualDocument(page, "http://wails.localhost", "0123456789abcdef0123456789abcdef", "", "", site)
	if !strings.Contains(doc, "cdn.jsdelivr.net") || !strings.Contains(doc, "default-src *") {
		t.Fatal("network visual rewritten or limited")
	}
	for _, bad := range []string{"javascript:alert(1)", `http://x" onload="y`, "http://wails.localhost/path"} {
		if _, err := visualDocument(page, bad, "0123456789abcdef0123456789abcdef", "", "", site); err == nil {
			t.Errorf("origin %q accepted", bad)
		}
	}
	// A page without head or html still gets the bridge before its content.
	doc, _ = visualDocument([]byte(`<p>bare</p>`), "wails://wails", "0123456789abcdef0123456789abcdef", "", "", &visualSite{})
	if !strings.HasPrefix(doc, `<base href="wails://wails/__vis/`) {
		t.Fatalf("bare page: %.120s", doc)
	}
}

func visualUIApp(t *testing.T, permission string) *App {
	t.Helper()
	c := permissionConfig(t, permission)
	a := permissionApp(c)
	a.bot.EnableVisuals()
	return a
}

func callVisualize(t *testing.T, a *App, args map[string]any) string {
	t.Helper()
	var tool tcagent.Tool
	for _, candidate := range nullbot.BuiltinTools(a.bot.Config(), a.bot) {
		if candidate.Definition().Name == "visualize" {
			tool = candidate
		}
	}
	if tool == nil {
		t.Fatal("no visualize tool")
	}
	out, err := tool.Call(context.Background(), args)
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	json.Unmarshal([]byte(out), &result)
	return result["id"].(string)
}

var srcdocToken = regexp.MustCompile(`/__vis/([0-9a-f]{32})/`)

func TestVisualKindsOpenInTheWindow(t *testing.T) {
	a := visualUIApp(t, "read-write")
	dir := a.bot.Config().WorkspaceDir
	writeFile(t, filepath.Join(dir, "web", "index.html"), []byte(`<html><head><script src="/assets/app.js"></script></head><body><a href="about.html">About</a></body></html>`))
	writeFile(t, filepath.Join(dir, "web", "about.html"), []byte(`<p>about</p>`))
	writeFile(t, filepath.Join(dir, "web", "assets", "app.js"), []byte(`console.log(1)`))
	writeFile(t, filepath.Join(dir, "photo.png"), []byte("\x89PNG\r\n\x1a\nxxxx"))
	writeFile(t, filepath.Join(dir, "report.pdf"), []byte("%PDF-1.4\n"))
	writeFile(t, filepath.Join(dir, "flow.drawio"), []byte(`<mxfile><diagram name="Flow">`+sampleDiagram+`</diagram></mxfile>`))
	origin := "http://wails.localhost"

	open := func(id string) VisualView {
		t.Helper()
		view, err := a.OpenVisualization(id, origin)
		if err != nil || view.Error != "" {
			t.Fatalf("open %s: %v %s", id, err, view.Error)
		}
		return view
	}
	site := open(callVisualize(t, a, map[string]any{"title": "Prototype", "path": filepath.Join(dir, "web", "index.html"), "root": filepath.Join(dir, "web")}))
	if site.Page != "index.html" || !strings.Contains(site.Document, `src="/__vis/`) || !strings.Contains(site.Document, "window.nullbot") {
		t.Fatalf("site page: %s %.300s", site.Page, site.Document)
	}
	next, err := a.VisualPage(site.Visual.ID, origin, "about.html")
	if err != nil || next.Page != "about.html" || !strings.Contains(next.Document, "<p>about</p>") {
		t.Fatalf("next page: %v %+v", err, next.Page)
	}
	if out, err := a.VisualPage(site.Visual.ID, origin, "../photo.png"); err == nil && out.Error == "" {
		t.Fatal("left the site folder")
	}

	img := open(callVisualize(t, a, map[string]any{"title": "Label", "path": "photo.png", "labels": []any{"crack"}}))
	if !strings.Contains(img.Document, `"src":"source.png"`) || !strings.Contains(img.Document, "/__nullbot/image.js") || !strings.Contains(img.Document, `"pins":true`) {
		t.Fatalf("image page: %.400s", img.Document)
	}
	chart := open(callVisualize(t, a, map[string]any{"title": "Chart", "content": `{"type":"bar","data":{"labels":["</script><script>x"],"datasets":[{"data":[1]}]}}`}))
	if strings.Contains(chart.Document, "</script><script>x") || !strings.Contains(chart.Document, `</script>`) {
		t.Fatal("chart data can end its script element")
	}
	svg := open(callVisualize(t, a, map[string]any{"title": "Drawing", "content": `<?xml version="1.0"?><!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>`}))
	if strings.Contains(svg.Document, "<?xml") || !strings.Contains(svg.Document, `<div class="nb-svg"><svg`) {
		t.Fatalf("svg page: %.300s", svg.Document)
	}
	diagram := open(callVisualize(t, a, map[string]any{"title": "Flow", "path": "flow.drawio"}))
	if !strings.Contains(diagram.Document, `data-page="Flow"`) || !strings.Contains(diagram.Document, `data-cell-id="api"`) {
		t.Fatal("diagram page lacks the diagram")
	}
	file := open(callVisualize(t, a, map[string]any{"title": "Report", "path": "report.pdf"}))
	if file.Preview == nil || file.Preview.Kind != "pdf" || file.Document != "" {
		t.Fatalf("file view: %+v", file)
	}
	writeFile(t, filepath.Join(dir, "a.png"), []byte("\x89PNG\r\n\x1a\n"))
	poll := open(callVisualize(t, a, map[string]any{"title": "Pick", "wait": false, "options": []any{map[string]any{"label": "A", "image": "a.png"}, "B"}}))
	if url := poll.Assets["option-1.png"]; !strings.HasPrefix(url, "/__vis/") {
		t.Fatalf("poll assets: %+v", poll.Assets)
	}
}

func TestVisualFilesAreServedInertAndOnlyToTheirSite(t *testing.T) {
	a := visualUIApp(t, "read-write")
	dir := a.bot.Config().WorkspaceDir
	writeFile(t, filepath.Join(dir, "web", "index.html"), []byte(`<p>home</p>`))
	writeFile(t, filepath.Join(dir, "web", "style.css"), []byte(`body{background:url("/img/bg.png")} i{background:url(/__nullbot/x)}`))
	writeFile(t, filepath.Join(dir, "web", "logo.svg"), []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`))
	writeFile(t, filepath.Join(dir, "secret.txt"), []byte("secret"))
	var navigated []string
	host := a.visualHost()
	host.navigated = func(id, page string) { navigated = append(navigated, id+" "+page) }
	id := callVisualize(t, a, map[string]any{"title": "Site", "path": filepath.Join(dir, "web", "index.html")})
	view, err := a.OpenVisualization(id, "http://wails.localhost")
	if err != nil {
		t.Fatal(err)
	}
	token := srcdocToken.FindStringSubmatch(view.Document)[1]
	handler := a.assetHandler()
	get := func(path string, headers ...string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "http://wails.localhost"+path, nil)
		for i := 0; i+1 < len(headers); i += 2 {
			req.Header.Set(headers[i], headers[i+1])
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	css := get("/__vis/" + token + "/style.css")
	if css.Code != 200 || !strings.Contains(css.Body.String(), `url("/__vis/`+token+`/img/bg.png")`) || !strings.Contains(css.Body.String(), "url(/__nullbot/x)") {
		t.Fatalf("css: %d %s", css.Code, css.Body.String())
	}
	if csp := css.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "sandbox") || !strings.Contains(csp, "default-src 'none'") {
		t.Fatalf("not inert: %q", csp)
	}
	if css.Header().Get("Content-Type") != "text/css; charset=utf-8" || css.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("headers: %v", css.Header())
	}
	// A frame navigating to a page gets an inert page; the app is told.
	page := get("/__vis/"+token+"/index.html", "Sec-Fetch-Dest", "iframe")
	if page.Code != 200 || strings.Contains(page.Body.String(), "home") || len(navigated) != 1 || navigated[0] != id+" index.html" {
		t.Fatalf("navigation: %d %q %v", page.Code, page.Body.String(), navigated)
	}
	if get("/__vis/"+token+"/index.html", "Sec-Fetch-Dest", "script").Code != 404 {
		t.Fatal("page served as a script")
	}
	if svg := get("/__vis/" + token + "/logo.svg"); svg.Code != 200 || !strings.Contains(svg.Header().Get("Content-Security-Policy"), "sandbox") {
		t.Fatal("svg served without the inert policy")
	}
	for _, path := range []string{
		"/__vis/" + token + "/../secret.txt",
		"/__vis/" + token + "/%2e%2e/secret.txt",
		"/__vis/" + strings.Repeat("0", 32) + "/index.html",
		"/__vis/nottoken/index.html",
		"/__nullbot/../go.mod",
		"/__nullbot/visualassets/bridge.js",
	} {
		if rec := get(path); rec.Code != 404 {
			t.Errorf("%s: %d", path, rec.Code)
		}
	}
	if rec := get("/__nullbot/lib/chart.js"); rec.Code != 200 || !strings.Contains(rec.Body.String(), "Chart.js v4") {
		t.Fatal("bundled Chart.js missing")
	}
	// A visual's own folder serves its content, never its records.
	inline := callVisualize(t, a, map[string]any{"title": "x", "content": "<p>x</p>"})
	view, _ = a.OpenVisualization(inline, "http://wails.localhost")
	inlineToken := srcdocToken.FindStringSubmatch(view.Document)[1]
	if get("/__vis/"+inlineToken+"/visual.json").Code != 404 || get("/__vis/"+inlineToken+"/events.jsonl").Code != 404 {
		t.Fatal("records served")
	}
	// A link out of the projects isn't followed.
	outside := t.TempDir()
	writeFile(t, filepath.Join(outside, "x"), []byte("outside"))
	if err := os.Symlink(outside, filepath.Join(dir, "web", "out")); err == nil {
		if rec := get("/__vis/" + token + "/out/x"); rec.Code != 404 {
			t.Fatalf("followed a link out of the projects: %d", rec.Code)
		}
	}
}

func TestVisualResponsesReachTheBot(t *testing.T) {
	a := visualUIApp(t, "read-write")
	id := callVisualize(t, a, map[string]any{"title": "Game", "content": "<canvas></canvas>"})
	if err := a.RecordVisualEvents(id, []map[string]any{{"type": "click", "target": "canvas"}}); err != nil {
		t.Fatal(err)
	}
	events, err := a.VisualEvents(id, 10)
	if err != nil || len(events) != 1 || events[0]["target"] != "canvas" {
		t.Fatalf("events: %v %v", events, err)
	}
	delivery, err := a.RespondVisualization(nullbot.VisualResponse{ID: id, Dismiss: true})
	if err != nil || delivery.Visual.Status != nullbot.VisualDismissed {
		t.Fatalf("dismiss: %+v %v", delivery, err)
	}
	if list := a.Visualizations(""); len(list) != 1 || list[0].ID != id {
		t.Fatalf("list: %+v", list)
	}
	if err := a.DeleteVisualization(id); err != nil {
		t.Fatal(err)
	}
	if len(a.Visualizations("")) != 0 {
		t.Fatal("not deleted")
	}
}
