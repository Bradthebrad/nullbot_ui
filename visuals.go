package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
)

// VisualView is what the window needs to show a visual.
type VisualView struct {
	Visual nullbot.Visualization `json:"visual"`
	// Document is the page for the sandboxed frame (srcdoc).
	Document string `json:"document,omitempty"`
	// Page is which page of a site Document is, relative to its root.
	Page string `json:"page,omitempty"`
	// Assets maps a poll option's picture to its address.
	Assets map[string]string `json:"assets,omitempty"`
	// Preview shows a file visual as Files would.
	Preview *FilePreview `json:"preview,omitempty"`
	// Error says why the visual can't be shown.
	Error string `json:"error,omitempty"`
}

func (a *App) visualHost() *visualSites {
	a.visualOnce.Do(func() {
		a.visuals = newVisualSites(
			func(path string) (string, error) {
				return checkUIProjectAccess(a.bot.Config(), path, nullbot.CapRead, false)
			},
			func(id, page string) {
				a.emit("visual-navigate", map[string]string{"id": id, "page": page})
			},
		)
	})
	return a.visuals
}

// assetHandler serves previews and visuals to the app's own page.
func (a *App) assetHandler() appAssets {
	return appAssets{local: a.localFiles, visuals: a.visualHost()}
}

// LiveVisualizations lists visuals waiting for a response since the app
// started.
func (a *App) LiveVisualizations() []nullbot.Visualization {
	if a.bot == nil {
		return nil
	}
	return a.bot.LiveVisualizations()
}

// Visualizations lists saved visuals, newest first; projectID limits them
// to one project.
func (a *App) Visualizations(projectID string) []nullbot.Visualization {
	return a.bot.Visualizations(strings.TrimSpace(projectID))
}

// Visualization returns one visual's record.
func (a *App) Visualization(id string) (nullbot.Visualization, error) {
	return a.bot.Visualization(id)
}

// OpenVisualization prepares a visual for the window. origin is the app
// page's own address, which the visual's files are served under.
func (a *App) OpenVisualization(id, origin string) (VisualView, error) {
	return a.visualView(id, origin, "")
}

// VisualPage shows another page of a visual's site, after the person
// followed a link to it.
func (a *App) VisualPage(id, origin, page string) (VisualView, error) {
	if strings.TrimSpace(page) == "" {
		return VisualView{}, errors.New("which page?")
	}
	return a.visualView(id, origin, page)
}

func (a *App) visualView(id, origin, page string) (VisualView, error) {
	v, err := a.bot.Visualization(id)
	if err != nil {
		return VisualView{}, err
	}
	view := VisualView{Visual: v}
	// The internet only while the projects it reads from still allow it.
	site := &visualSite{visualID: v.ID, dataDir: v.Dir, network: a.bot.VisualNetworkAllowed(v)}
	if v.Kind == nullbot.VisualHTML && v.Root != "" {
		// Links are resolved once, so every file served is checked against
		// the folder as it really is.
		root, err := filepath.EvalSymlinks(v.Root)
		if err != nil {
			view.Error = "The visual's folder is gone: " + err.Error()
			return view, nil
		}
		site.root = root
	}
	host := a.visualHost()
	token, err := host.register(site)
	if err != nil {
		return VisualView{}, err
	}
	fail := func(err error) (VisualView, error) {
		view.Error = err.Error()
		return view, nil
	}
	switch v.Kind {
	case nullbot.VisualPoll:
		for _, option := range v.Options {
			if option.Image != "" {
				if view.Assets == nil {
					view.Assets = map[string]string{}
				}
				view.Assets[option.Image] = visualPrefix + token + "/" + pathEscape(option.Image)
			}
		}
		return view, nil
	case nullbot.VisualFile:
		preview, err := a.PreviewFile(v.Source)
		if err != nil {
			return fail(err)
		}
		view.Preview = &preview
		return view, nil
	}
	if page != "" && v.Kind != nullbot.VisualHTML {
		return fail(errors.New("this visual is a single page"))
	}
	doc, dir, pageName, err := a.visualPageSource(v, site, page)
	if err != nil {
		return fail(err)
	}
	document, err := visualDocument(doc, origin, token, dir, pageName, site)
	if err != nil {
		return VisualView{}, err
	}
	view.Document, view.Page = document, pageName
	return view, nil
}

// visualPageSource is the page to show and the folder its links start in,
// relative to the site.
func (a *App) visualPageSource(v nullbot.Visualization, site *visualSite, page string) ([]byte, string, string, error) {
	readData := func(name string) ([]byte, error) {
		if name == "" || name != filepath.Base(name) {
			return nil, errors.New("the visual's content is missing")
		}
		file := filepath.Join(v.Dir, name)
		if info, err := os.Lstat(file); err != nil || !info.Mode().IsRegular() {
			return nil, errors.New("the visual's content is missing or not a plain file")
		}
		return readLimited(file, maxVisualPage)
	}
	title := v.Title
	switch v.Kind {
	case nullbot.VisualHTML:
		if site.root == "" {
			if page != "" {
				return nil, "", "", errors.New("this visual is a single page")
			}
			data, err := readData(v.ContentFile)
			return data, "", "", err
		}
		target := v.Source
		if page != "" {
			target = filepath.Join(site.root, filepath.FromSlash(strings.TrimPrefix(page, "/")))
		}
		if target == "" {
			// Inline content shown with a project folder as its site.
			data, err := readData(v.ContentFile)
			return data, "", "", err
		}
		for _, part := range strings.Split(filepath.ToSlash(target), "/") {
			if strings.EqualFold(part, ".nullbot") {
				return nil, "", "", errors.New("NullBot's records can't be shown as a page")
			}
		}
		resolved, err := siteFile(site.root, target, func(path string) (string, error) {
			return checkUIProjectAccess(a.bot.Config(), path, nullbot.CapRead, false)
		})
		if err != nil {
			return nil, "", "", fmt.Errorf("that page can't be shown: %w", err)
		}
		if !isPageFile(resolved) {
			return nil, "", "", fmt.Errorf("%s is not a web page", filepath.Base(resolved))
		}
		data, err := readLimited(resolved, maxVisualPage)
		if err != nil {
			return nil, "", "", err
		}
		rel, _ := filepath.Rel(site.root, resolved)
		rel = filepath.ToSlash(rel)
		return data, filepathDirSlash(rel), rel, nil
	case nullbot.VisualSVG:
		data, err := readData(v.ContentFile)
		if err != nil {
			return nil, "", "", err
		}
		return hostPage(title, "svg", `<main class="nb-stage"><div class="nb-svg">`+inlineSVG(string(data))+`</div></main>`), "", "", nil
	case nullbot.VisualImage:
		config, err := jsonScript("nb-visual", map[string]any{"src": pathEscape(v.ContentFile), "labels": v.Labels, "title": title, "pins": len(v.Labels) > 0})
		if err != nil {
			return nil, "", "", err
		}
		return hostPage(title, "image", `<main class="nb-stage"></main>`+config, "/__nullbot/image.js"), "", "", nil
	case nullbot.VisualChart:
		data, err := readData(v.ContentFile)
		if err != nil {
			return nil, "", "", err
		}
		var config any
		if err := json.Unmarshal(data, &config); err != nil {
			return nil, "", "", fmt.Errorf("the chart config isn't valid JSON: %v", err)
		}
		script, err := jsonScript("nb-visual", config)
		if err != nil {
			return nil, "", "", err
		}
		return hostPage(title, "chart", `<main class="nb-stage"></main>`+script, "/__nullbot/lib/chart.js", "/__nullbot/chart.js"), "", "", nil
	case nullbot.VisualDrawio:
		data, err := readData(v.ContentFile)
		if err != nil {
			return nil, "", "", err
		}
		pages, err := drawioPages(data, maxDrawioPages)
		if err != nil {
			return nil, "", "", err
		}
		var body strings.Builder
		if len(pages) > 1 {
			body.WriteString(`<div class="nb-bar" data-nullbot-ignore><span class="nb-hint">Pages</span></div>`)
		}
		body.WriteString(`<main class="nb-stage">`)
		for _, p := range pages {
			fmt.Fprintf(&body, `<section class="nb-page nb-svg" data-page="%s">%s</section>`, attrEscape(p.Name), p.SVG)
		}
		body.WriteString(`</main>`)
		return hostPage(title, "drawio", body.String(), "/__nullbot/drawio.js"), "", "", nil
	}
	return nil, "", "", fmt.Errorf("%s visuals can't be shown here", v.Kind)
}

func filepathDirSlash(rel string) string {
	if i := strings.LastIndex(rel, "/"); i >= 0 {
		return rel[:i]
	}
	return ""
}

func readLimited(path string, limit int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("%s is larger than %d MB", filepath.Base(path), limit>>20)
	}
	return data, nil
}

// RecordVisualEvents saves interactions collected in the window.
func (a *App) RecordVisualEvents(id string, events []map[string]any) error {
	if len(events) > 1000 {
		events = events[:1000]
	}
	return a.bot.RecordVisualEvents(id, events)
}

// VisualEvents reads a visual's latest interactions.
func (a *App) VisualEvents(id string, limit int) ([]map[string]any, error) {
	if limit <= 0 || limit > 5000 {
		limit = 5000
	}
	return a.bot.VisualEvents(id, limit)
}

// RespondVisualization sends the person's response, or skips the visual.
func (a *App) RespondVisualization(req nullbot.VisualResponse) (nullbot.VisualDelivery, error) {
	return a.bot.RespondVisualization(req)
}

// DeleteVisualization removes a saved visual.
func (a *App) DeleteVisualization(id string) error {
	if err := a.bot.DeleteVisualization(id); err != nil {
		return err
	}
	a.visualHost().forget(id)
	return nil
}

// RevealVisualization shows a visual's folder in the file manager.
func (a *App) RevealVisualization(id string) error {
	v, err := a.bot.Visualization(id)
	if err != nil {
		return err
	}
	return revealInFileManager(v.Dir)
}
