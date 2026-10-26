package main

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf16"
)

func writeFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func writeZip(t *testing.T, path string, files map[string]string) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	for name, body := range files {
		w, _ := zw.Create(name)
		w.Write([]byte(body))
	}
	zw.Close()
	f.Close()
}

func TestFileKindsCoverCommonTypes(t *testing.T) {
	cases := map[string]string{
		"a.md": "markdown", "notes.txt": "text", "main.go": "code", "app.tsx": "code", "build.gradle": "code", "q.sql": "code",
		"data.json": "json", "rows.jsonl": "data", "t.tsv": "csv", "page.html": "html", "book.xlsx": "xlsx", "calc.ods": "ods",
		"report.docx": "docx", "memo.odt": "odt", "old.rtf": "rtf", "deck.pptx": "pptx", "talk.odp": "odp", "x.pdf": "pdf",
		"p.webp": "image", "i.ico": "image", "song.mp3": "audio", "clip.mp4": "video", "f.woff2": "font", "a.tar.gz": "archive",
		"bundle.7z": "archive", "Dockerfile": "code", "Makefile": "code", "LICENSE": "text", ".bashrc": "text", "setup.exe": "binary",
	}
	for name, want := range cases {
		if got := fileKind(name); got != want {
			t.Errorf("%s: %s, want %s", name, got, want)
		}
	}
}

func TestPreviewsReadManyFormats(t *testing.T) {
	c := permissionConfig(t, "read-write")
	a := permissionApp(c)
	dir := c.WorkspaceDir
	// UTF-16 text, as Windows tools write it.
	units := utf16.Encode([]rune("héllo from PowerShell\r\n"))
	data := []byte{0xFF, 0xFE}
	for _, u := range units {
		data = append(data, byte(u), byte(u>>8))
	}
	writeFile(t, filepath.Join(dir, "out.log"), data)
	writeFile(t, filepath.Join(dir, "cfg.json"), []byte(`{"a":1,"b":[2,3]}`))
	writeFile(t, filepath.Join(dir, "legacy.txt"), []byte("caf\xe9 \x93quoted\x94"))
	writeFile(t, filepath.Join(dir, "doc.rtf"), []byte(`{\rtf1\ansi{\fonttbl{\f0 Arial;}}\f0 Hello \b bold\b0\par Caf\'e9 \u8364? done}`))
	writeFile(t, filepath.Join(dir, "blob.bin"), []byte{0, 1, 2, 3, 'N', 'B', 0xFF})
	writeFile(t, filepath.Join(dir, "unknown.xyz"), []byte("plain words in an unknown file"))
	writeZip(t, filepath.Join(dir, "deck.pptx"), map[string]string{
		"ppt/slides/slide2.xml": `<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sld>`,
		"ppt/slides/slide1.xml": `<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>First slide</a:t></a:r></a:p></p:sld>`,
	})
	writeZip(t, filepath.Join(dir, "memo.odt"), map[string]string{"content.xml": `<office:document-content xmlns:office="o" xmlns:text="t"><office:body><text:p>Memo line one</text:p><text:p>Line two</text:p></office:body></office:document-content>`})
	writeZip(t, filepath.Join(dir, "calc.ods"), map[string]string{"content.xml": `<d xmlns:table="t" xmlns:text="x"><table:table><table:table-row><table:table-cell><text:p>Name</text:p></table:table-cell><table:table-cell><text:p>Qty</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>Bolts</text:p></table:table-cell><table:table-cell><text:p>40</text:p></table:table-cell></table:table-row></table:table></d>`})
	writeZip(t, filepath.Join(dir, "files.zip"), map[string]string{"b.txt": "bb", "a/x.txt": "x"})
	tgz, _ := os.Create(filepath.Join(dir, "logs.tar.gz"))
	gz := gzip.NewWriter(tgz)
	tw := tar.NewWriter(gz)
	tw.WriteHeader(&tar.Header{Name: "logs/app.log", Size: 5, Mode: 0o600})
	tw.Write([]byte("hello"))
	tw.Close()
	gz.Close()
	tgz.Close()

	check := func(name string, ok func(FilePreview) bool) {
		t.Helper()
		p, err := a.PreviewFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if !ok(p) {
			t.Errorf("%s: unexpected preview %+v", name, p)
		}
	}
	check("out.log", func(p FilePreview) bool { return strings.Contains(p.Content, "héllo from PowerShell") && p.Editable })
	check("cfg.json", func(p FilePreview) bool { return p.Kind == "json" && strings.Contains(p.Formatted, "\n  \"a\": 1") })
	check("legacy.txt", func(p FilePreview) bool { return p.Content == "café “quoted”" })
	check("doc.rtf", func(p FilePreview) bool {
		return strings.Contains(p.Content, "Hello bold") && strings.Contains(p.Content, "Café €") && !strings.Contains(p.Content, "Arial")
	})
	check("blob.bin", func(p FilePreview) bool { return p.Kind == "binary" && strings.Contains(p.Hex, "00 01 02 03 4e 42 ff") })
	check("unknown.xyz", func(p FilePreview) bool { return p.Kind == "text" && p.Content == "plain words in an unknown file" })
	check("deck.pptx", func(p FilePreview) bool {
		return strings.Index(p.Content, "First slide") < strings.Index(p.Content, "Second slide") && strings.HasPrefix(p.Content, "Slide 1")
	})
	check("memo.odt", func(p FilePreview) bool { return strings.Contains(p.Content, "Memo line one\nLine two") })
	check("calc.ods", func(p FilePreview) bool { return len(p.Headers) == 2 && p.Headers[1] == "Qty" && p.Rows[0][0] == "Bolts" })
	check("files.zip", func(p FilePreview) bool { return p.Count == 2 && p.Entries[0].Name == "a/x.txt" })
	check("logs.tar.gz", func(p FilePreview) bool { return p.Count == 1 && p.Entries[0].Name == "logs/app.log" && p.Entries[0].Size == 5 })
}

func TestSearchFindsFilesInSubfoldersOnly(t *testing.T) {
	c := permissionConfig(t, "read-only")
	a := permissionApp(c)
	dir := c.WorkspaceDir
	for _, name := range []string{"reports/q3/summary.md", "reports/q3/budget.xlsx", "src/report_gen.go", "node_modules/report/index.js", "Report.txt", "images/report.png"} {
		writeFile(t, filepath.Join(dir, filepath.FromSlash(name)), []byte("x"))
	}
	res, err := a.SearchFiles(FileSearchRequest{Root: dir, Query: "report"})
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, e := range res.Entries {
		got = append(got, e.RelPath)
	}
	joined := strings.Join(got, ",")
	for _, want := range []string{"reports", "src/report_gen.go", "Report.txt", "images/report.png"} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %s in %v", want, got)
		}
	}
	if strings.Contains(joined, "node_modules") || len(res.Skipped) != 1 {
		t.Fatalf("searched inside node_modules: %v %v", got, res.Skipped)
	}
	docs, _ := a.SearchFiles(FileSearchRequest{Root: dir, Query: "q3/", Kind: "sheet"})
	if len(docs.Entries) != 1 || docs.Entries[0].Name != "budget.xlsx" {
		t.Fatalf("path words and kind filter: %+v", docs.Entries)
	}
	glob, _ := a.SearchFiles(FileSearchRequest{Root: dir, Query: "*.md"})
	if len(glob.Entries) != 1 || glob.Entries[0].Name != "summary.md" {
		t.Fatalf("pattern: %+v", glob.Entries)
	}
	if _, err := a.SearchFiles(FileSearchRequest{Root: t.TempDir(), Query: "x"}); err == nil {
		t.Fatal("searched outside the projects")
	}
}

func TestCopyMoveAndDuplicate(t *testing.T) {
	c := permissionConfig(t, "read-write")
	a := permissionApp(c)
	dir := c.WorkspaceDir
	writeFile(t, filepath.Join(dir, "a.txt"), []byte("A"))
	writeFile(t, filepath.Join(dir, "folder", "inner.txt"), []byte("I"))
	if err := os.Mkdir(filepath.Join(dir, "dest"), 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := a.CopyPaths(FileTransferRequest{Sources: []string{filepath.Join(dir, "a.txt"), filepath.Join(dir, "folder")}, Dest: filepath.Join(dir, "dest")}); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "dest", "folder", "inner.txt")); string(b) != "I" {
		t.Fatal("folder not copied")
	}
	// Duplicating in place picks a free name.
	if _, err := a.CopyPaths(FileTransferRequest{Sources: []string{filepath.Join(dir, "a.txt"), filepath.Join(dir, "a.txt")}, Dest: dir}); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"a (copy).txt", "a (copy 2).txt"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatalf("%s missing", name)
		}
	}
	if _, err := a.CopyPaths(FileTransferRequest{Sources: []string{filepath.Join(dir, "folder")}, Dest: filepath.Join(dir, "folder")}); err == nil {
		t.Fatal("copied a folder into itself")
	}
	if _, err := a.CopyPaths(FileTransferRequest{Sources: []string{filepath.Join(dir, "a.txt")}, Dest: filepath.Join(dir, "dest"), Move: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "a.txt")); !os.IsNotExist(err) {
		t.Fatal("move left the original")
	}
	if _, err := os.Stat(filepath.Join(dir, "dest", "a (copy).txt")); err != nil {
		t.Fatal("moved file not renamed around the existing copy")
	}
}

func TestCopyNeedsWriteAtTheDestination(t *testing.T) {
	c := permissionConfig(t, "read-only")
	a := permissionApp(c)
	writeFile(t, filepath.Join(c.WorkspaceDir, "a.txt"), []byte("A"))
	if _, err := a.CopyPaths(FileTransferRequest{Sources: []string{filepath.Join(c.WorkspaceDir, "a.txt")}, Dest: c.WorkspaceDir}); err == nil {
		t.Fatal("copied into a read-only project")
	}
}
