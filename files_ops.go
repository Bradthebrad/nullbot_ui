package main

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
)

// FileSearchRequest searches a folder and everything below it.
type FileSearchRequest struct {
	Root  string `json:"root"`
	Query string `json:"query"`
	// Kind narrows results: "folder", "document", "code", "image", "sheet",
	// "media", "archive", or empty for everything.
	Kind  string `json:"kind,omitempty"`
	Limit int    `json:"limit,omitempty"`
}

type FileSearchResult struct {
	Root    string      `json:"root"`
	Entries []FileEntry `json:"entries"`
	// Scanned counts the files and folders looked at.
	Scanned int `json:"scanned"`
	// Truncated is set when the limit, or the time allowed, cut the search short.
	Truncated bool `json:"truncated"`
	// Skipped names folders left out because they hold tool caches.
	Skipped []string `json:"skipped,omitempty"`
}

// skipDirs are version-control and dependency folders, which are large and
// rarely what someone is looking for. Searching inside one still works:
// make it the root.
var skipDirs = map[string]bool{".git": true, ".hg": true, ".svn": true, "node_modules": true, "__pycache__": true, ".venv": true, "venv": true, ".tox": true, ".mypy_cache": true, ".pytest_cache": true, ".gradle": true, ".next": true, ".nuxt": true, ".cache": true, ".terraform": true}

var kindGroups = map[string]map[string]bool{
	"document": {"markdown": true, "text": true, "docx": true, "odt": true, "rtf": true, "pdf": true, "pptx": true, "odp": true, "html": true},
	"code":     {"code": true, "json": true, "data": true},
	"image":    {"image": true},
	"sheet":    {"csv": true, "xlsx": true, "ods": true},
	"media":    {"audio": true, "video": true},
	"archive":  {"archive": true},
}

const (
	searchTimeBudget = 4 * time.Second
	searchMaxScanned = 400_000
)

// SearchFiles finds files and folders whose name (or path below root)
// matches every word of the query. "*" and "?" match like in a file
// manager. Results stay inside projects you can read.
func (a *App) SearchFiles(req FileSearchRequest) (FileSearchResult, error) {
	config := a.bot.Config()
	root, err := checkUIProjectPath(config, strings.TrimSpace(req.Root), false, false)
	if err != nil {
		return FileSearchResult{}, err
	}
	info, err := os.Stat(root)
	if err != nil {
		return FileSearchResult{}, err
	}
	if !info.IsDir() {
		root = filepath.Dir(root)
	}
	limit := req.Limit
	if limit <= 0 || limit > 2000 {
		limit = 500
	}
	words := strings.Fields(strings.ToLower(req.Query))
	group := kindGroups[req.Kind]
	result := FileSearchResult{Root: root, Entries: []FileEntry{}}
	if len(words) == 0 && req.Kind == "" {
		return result, nil
	}
	deadline := time.Now().Add(searchTimeBudget)
	skipped := map[string]bool{}
	stop := errors.New("stop")
	walkErr := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			if entry != nil && entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if path == root {
			return nil
		}
		result.Scanned++
		if result.Scanned > searchMaxScanned || time.Now().After(deadline) {
			result.Truncated = true
			return stop
		}
		name := entry.Name()
		if entry.IsDir() && skipDirs[strings.ToLower(name)] {
			skipped[name] = true
			return fs.SkipDir
		}
		// Symbolic links and junctions are listed but never followed.
		rel, _ := filepath.Rel(root, path)
		if !matchesSearch(words, strings.ToLower(name), strings.ToLower(filepath.ToSlash(rel))) {
			return nil
		}
		kind := "folder"
		if !entry.IsDir() {
			kind = fileKind(path)
		}
		switch {
		case req.Kind == "folder" && !entry.IsDir():
			return nil
		case group != nil && !group[kind]:
			return nil
		}
		fileInfo, err := entry.Info()
		if err != nil {
			return nil
		}
		result.Entries = append(result.Entries, FileEntry{
			Name:      name,
			Path:      path,
			RelPath:   filepath.ToSlash(rel),
			IsDir:     entry.IsDir(),
			Size:      fileInfo.Size(),
			Modified:  fileInfo.ModTime(),
			Extension: strings.ToLower(filepath.Ext(name)),
			Kind:      kind,
		})
		if len(result.Entries) >= limit {
			result.Truncated = true
			return stop
		}
		return nil
	})
	if walkErr != nil && !errors.Is(walkErr, stop) {
		return result, walkErr
	}
	for name := range skipped {
		result.Skipped = append(result.Skipped, name)
	}
	sort.Strings(result.Skipped)
	// Names that match best first: exact, then starting with the query.
	if len(words) > 0 {
		first := words[0]
		score := func(e FileEntry) int {
			name := strings.ToLower(e.Name)
			switch {
			case name == first || strings.TrimSuffix(name, strings.ToLower(e.Extension)) == first:
				return 0
			case strings.HasPrefix(name, first):
				return 1
			case strings.Contains(name, first):
				return 2
			}
			return 3
		}
		sort.SliceStable(result.Entries, func(i, j int) bool {
			si, sj := score(result.Entries[i]), score(result.Entries[j])
			if si != sj {
				return si < sj
			}
			return strings.Count(result.Entries[i].RelPath, "/") < strings.Count(result.Entries[j].RelPath, "/")
		})
	}
	return result, nil
}

// matchesSearch: every word must match the name, or the path for words
// containing a slash. Words with * or ? are file-name patterns.
func matchesSearch(words []string, name, rel string) bool {
	for _, word := range words {
		target := name
		if strings.Contains(word, "/") {
			target = rel
		}
		if strings.ContainsAny(word, "*?") {
			if ok, _ := filepath.Match(word, target); !ok {
				return false
			}
			continue
		}
		if !strings.Contains(target, word) {
			return false
		}
	}
	return true
}

// FileTransferRequest copies or moves files and folders into a folder.
type FileTransferRequest struct {
	Sources []string `json:"sources"`
	Dest    string   `json:"dest"`
	Move    bool     `json:"move,omitempty"`
}

// CopyPaths copies (or with Move, moves) files and folders into Dest. Names
// already taken get " (copy)" or " (copy 2)". Copying needs read access to
// the sources and write access to the destination; moving also needs delete
// access to the sources.
func (a *App) CopyPaths(req FileTransferRequest) (FileBrowser, error) {
	config := a.bot.Config()
	dest, err := checkUIProjectPath(config, strings.TrimSpace(req.Dest), true, false)
	if err != nil {
		return FileBrowser{}, err
	}
	if info, err := os.Stat(dest); err != nil || !info.IsDir() {
		return FileBrowser{}, fmt.Errorf("%s is not a folder", req.Dest)
	}
	if len(req.Sources) == 0 {
		return a.listFiles(dest)
	}
	var problems []string
	for _, raw := range req.Sources {
		if err := a.transferOne(config, raw, dest, req.Move); err != nil {
			problems = append(problems, fmt.Sprintf("%s: %v", filepath.Base(raw), err))
		}
	}
	listing, err := a.listFiles(dest)
	if len(problems) > 0 {
		return listing, errors.New(strings.Join(problems, "; "))
	}
	return listing, err
}

func (a *App) transferOne(config nullbot.Config, raw, dest string, move bool) error {
	capability := nullbot.CapRead
	if move {
		capability = nullbot.CapDelete
	}
	source, err := checkUIProjectAccess(config, strings.TrimSpace(raw), capability, true)
	if err != nil {
		return err
	}
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if info.IsDir() && (samePath(source, dest) || isWithin(dest, source)) {
		return errors.New("can’t copy a folder into itself")
	}
	if move && samePath(filepath.Dir(source), dest) {
		return nil
	}
	target := availableName(dest, filepath.Base(source))
	if _, err := checkUIProjectAccess(config, target, nullbot.CapWrite, info.IsDir()); err != nil {
		return err
	}
	if move {
		if err := os.Rename(source, target); err == nil {
			return nil
		}
		// Across volumes: copy, then remove the original.
		if err := copyTree(source, target); err != nil {
			return err
		}
		return os.RemoveAll(source)
	}
	return copyTree(source, target)
}

func isWithin(path, dir string) bool {
	rel, err := filepath.Rel(dir, path)
	return err == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// availableName returns dir/name, or "name (copy).ext", "name (copy 2).ext"
// when that is taken.
func availableName(dir, name string) string {
	candidate := filepath.Join(dir, name)
	if _, err := os.Lstat(candidate); os.IsNotExist(err) {
		return candidate
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 1; i < 1000; i++ {
		suffix := " (copy)"
		if i > 1 {
			suffix = fmt.Sprintf(" (copy %d)", i)
		}
		candidate = filepath.Join(dir, stem+suffix+ext)
		if _, err := os.Lstat(candidate); os.IsNotExist(err) {
			return candidate
		}
	}
	return filepath.Join(dir, fmt.Sprintf("%s (copy %d)%s", stem, time.Now().UnixNano(), ext))
}

// copyTree copies a file or folder. Symbolic links are copied as links, so
// a copy never reaches outside what was selected.
func copyTree(source, target string) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	switch {
	case info.Mode()&os.ModeSymlink != 0:
		link, err := os.Readlink(source)
		if err != nil {
			return err
		}
		return os.Symlink(link, target)
	case info.IsDir():
		if err := os.Mkdir(target, info.Mode().Perm()|0o700); err != nil {
			return err
		}
		entries, err := os.ReadDir(source)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := copyTree(filepath.Join(source, entry.Name()), filepath.Join(target, entry.Name())); err != nil {
				return err
			}
		}
		return nil
	case info.Mode().IsRegular():
		in, err := os.Open(source)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, info.Mode().Perm()|0o600)
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, in); err != nil {
			out.Close()
			os.Remove(target)
			return err
		}
		if err := out.Close(); err != nil {
			return err
		}
		return os.Chtimes(target, time.Now(), info.ModTime())
	default:
		return fmt.Errorf("%s is not a regular file", filepath.Base(source))
	}
}

// OpenWith asks the system which app to open a file with. Programs and
// scripts are shown in the file manager instead, as with Open.
func (a *App) OpenWith(path string) error {
	resolved, err := checkUIProjectPath(a.bot.Config(), strings.TrimSpace(path), false, false)
	if err != nil {
		return err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return err
	}
	if info.IsDir() || revealOnlyExtensions[strings.ToLower(filepath.Ext(resolved))] {
		return revealInFileManager(resolved)
	}
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32.exe", "shell32.dll,OpenAs_RunDLL", resolved).Start()
	case "darwin":
		script := `set chosen to choose application with prompt "Open with:"
do shell script "open -a " & quoted form of (POSIX path of (path to chosen)) & " " & quoted form of (item 1 of argv)`
		return exec.Command("osascript", "-e", "on run argv", "-e", script, "-e", "end run", resolved).Start()
	default:
		return errors.New("this system has no app chooser; use Open in default app")
	}
}
