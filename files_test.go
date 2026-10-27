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
	check("calc.ods", func(p FilePreview) bool {
		return len(p.Headers) == 2 && p.Headers[1] == "Qty" && p.Rows[0][0] == "Bolts"
	})
	check("files.zip", func(p FilePreview) bool { return p.Count == 2 && p.Entries[0].Name == "a/x.txt" })
	check("logs.tar.gz", func(p FilePreview) bool {
		return p.Count == 1 && p.Entries[0].Name == "logs/app.log" && p.Entries[0].Size == 5
	})
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

func TestLinksAreDeletedAndMovedThemselves(t *testing.T) {
	c := permissionConfig(t, "read-write")
	a := permissionApp(c)
	dir := c.WorkspaceDir
	outside := t.TempDir()
	writeFile(t, filepath.Join(outside, "keep.txt"), []byte("K"))
	writeFile(t, filepath.Join(dir, "target", "inner.txt"), []byte("I"))
	if err := os.Symlink(outside, filepath.Join(dir, "away")); err != nil {
		t.Skip("symlinks unavailable:", err)
	}
	if err := os.Symlink(filepath.Join(dir, "target"), filepath.Join(dir, "near")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "dest"), 0o700); err != nil {
		t.Fatal(err)
	}
	// Renaming a link renames the link.
	if _, err := a.RenamePath(FileRenameRequest{Path: filepath.Join(dir, "away"), NewName: "elsewhere"}); err != nil {
		t.Fatal(err)
	}
	if target, err := os.Readlink(filepath.Join(dir, "elsewhere")); err != nil || target != outside {
		t.Fatalf("renamed link: %q %v", target, err)
	}
	if _, err := a.RenamePath(FileRenameRequest{Path: dir, NewName: "renamed"}); err == nil {
		t.Fatal("renamed the project folder")
	}
	// Renaming onto another file is refused, even one differing only in case.
	writeFile(t, filepath.Join(dir, "a.txt"), []byte("a"))
	writeFile(t, filepath.Join(dir, "B.txt"), []byte("B"))
	if _, err := a.RenamePath(FileRenameRequest{Path: filepath.Join(dir, "a.txt"), NewName: "B.txt"}); err == nil {
		t.Fatal("renamed over an existing file")
	}
	if _, err := os.Stat(filepath.Join(dir, "b.txt")); os.IsNotExist(err) {
		// Case-sensitive file system: b.txt and B.txt are different files.
		writeFile(t, filepath.Join(dir, "b.txt"), []byte("b"))
		if _, err := a.RenamePath(FileRenameRequest{Path: filepath.Join(dir, "b.txt"), NewName: "B.txt"}); err == nil {
			t.Fatal("renamed over a file whose name differs only in case")
		}
		if data, _ := os.ReadFile(filepath.Join(dir, "B.txt")); string(data) != "B" {
			t.Fatal("B.txt overwritten")
		}
	}
	// Deleting a link to a folder outside the projects removes the link only.
	if _, err := a.DeletePath(filepath.Join(dir, "elsewhere")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(dir, "elsewhere")); !os.IsNotExist(err) {
		t.Fatal("link not deleted")
	}
	if _, err := os.Stat(filepath.Join(outside, "keep.txt")); err != nil {
		t.Fatal("deleting the link removed what it pointed to")
	}
	// Moving a link moves the link; the folder it points to stays.
	if _, err := a.CopyPaths(FileTransferRequest{Sources: []string{filepath.Join(dir, "near")}, Dest: filepath.Join(dir, "dest"), Move: true}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(filepath.Join(dir, "dest", "near"))
	if err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("moved link is not a link: %v %v", info, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "target", "inner.txt")); err != nil {
		t.Fatal("moving the link moved its target")
	}
	// The project folder itself is never deleted.
	if _, err := a.DeletePath(dir); err == nil {
		t.Fatal("deleted the project folder")
	}
}

func TestSaveKeepsTheFileEncoding(t *testing.T) {
	c := permissionConfig(t, "read-write")
	a := permissionApp(c)
	dir := c.WorkspaceDir
	le := []byte{0xFF, 0xFE}
	for _, u := range utf16.Encode([]rune("old\r\n")) {
		le = append(le, byte(u), byte(u>>8))
	}
	writeFile(t, filepath.Join(dir, "ps.log"), le)
	writeFile(t, filepath.Join(dir, "bom.txt"), append([]byte{0xEF, 0xBB, 0xBF}, "old"...))
	writeFile(t, filepath.Join(dir, "legacy.txt"), []byte("caf\xe9"))

	p, err := a.SaveFile(SaveFileRequest{Path: filepath.Join(dir, "ps.log"), Content: "new ✓ text"})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "ps.log"))
	if p.Encoding != "utf-16le" || p.Content != "new ✓ text" || raw[0] != 0xFF || raw[1] != 0xFE || len(raw) != 2+2*len([]rune("new ✓ text")) {
		t.Fatalf("UTF-16 round trip: %q %q % x", p.Encoding, p.Content, raw)
	}
	if _, err := a.SaveFile(SaveFileRequest{Path: filepath.Join(dir, "bom.txt"), Content: "new"}); err != nil {
		t.Fatal(err)
	}
	if raw, _ := os.ReadFile(filepath.Join(dir, "bom.txt")); string(raw) != "\xEF\xBB\xBFnew" {
		t.Fatalf("byte order mark lost: % x", raw)
	}
	legacy, err := a.PreviewFile(filepath.Join(dir, "legacy.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if legacy.Editable || legacy.Encoding != "windows-1252" || legacy.ReadOnlyReason == "" {
		t.Fatalf("Windows-1252 file offered for editing: %+v", legacy)
	}
	if _, err := a.SaveFile(SaveFileRequest{Path: filepath.Join(dir, "legacy.txt"), Content: "x"}); err == nil || !strings.Contains(err.Error(), "Windows-1252") {
		t.Fatalf("saved over a Windows-1252 file: %v", err)
	}
	if raw, _ := os.ReadFile(filepath.Join(dir, "legacy.txt")); string(raw) != "caf\xe9" {
		t.Fatal("legacy file changed")
	}
}

func TestPreviewGuards(t *testing.T) {
	c := permissionConfig(t, "read-only")
	a := permissionApp(c)
	dir := c.WorkspaceDir
	deep := strings.Repeat("[", 60) + strings.Repeat("]", 60)
	writeFile(t, filepath.Join(dir, "deep.json"), []byte(deep))
	writeFile(t, filepath.Join(dir, "quoted.json"), []byte(`{"text":"[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[\"]"}`))
	p, err := a.PreviewFile(filepath.Join(dir, "deep.json"))
	if err != nil || p.Formatted != "" || p.Content != deep {
		t.Fatalf("deeply nested JSON formatted: %v %q", err, p.Formatted)
	}
	p, err = a.PreviewFile(filepath.Join(dir, "quoted.json"))
	if err != nil || !strings.Contains(p.Formatted, "\n  \"text\"") {
		t.Fatalf("brackets inside strings counted as nesting: %v %q", err, p.Formatted)
	}
	if got := jsonDepth(`{"a":[1,{"b":"]]]"}]}`); got != 3 {
		t.Fatalf("jsonDepth = %d", got)
	}

	// A lone .gz reports its unpacked size from the trailer.
	f, _ := os.Create(filepath.Join(dir, "notes.txt.gz"))
	gz := gzip.NewWriter(f)
	gz.Write([]byte(strings.Repeat("hello ", 1000)))
	gz.Close()
	f.Close()
	p, err = a.PreviewFile(filepath.Join(dir, "notes.txt.gz"))
	if err != nil || p.Count != 1 || p.Entries[0].Size != 6000 || p.Entries[0].Name != "notes.txt" {
		t.Fatalf("gz: %v %+v", err, p.Entries)
	}

	// Zip entries are read through a limit.
	var big strings.Builder
	big.WriteString(`<w:document xmlns:w="w"><w:body>`)
	for big.Len() < 3*maxExtractedText {
		big.WriteString(`<w:p><w:r><w:t>words words words words words words words</w:t></w:r></w:p>`)
	}
	big.WriteString(`</w:body></w:document>`)
	writeZip(t, filepath.Join(dir, "long.docx"), map[string]string{"word/document.xml": big.String()})
	p, err = a.PreviewFile(filepath.Join(dir, "long.docx"))
	if err != nil || len(p.Content) == 0 || len(p.Content) > maxExtractedText+1000 {
		t.Fatalf("docx text not capped: %v %d", err, len(p.Content))
	}
}

func TestEncodeText(t *testing.T) {
	for _, enc := range []string{"utf-8", "utf-8-bom", "utf-16le", "utf-16be"} {
		data, err := encodeText("añ €𝄞", enc)
		if err != nil {
			t.Fatal(enc, err)
		}
		if text, got := decodeText(data, false); text != "añ €𝄞" || got != enc {
			t.Fatalf("%s: got %q as %s", enc, text, got)
		}
	}
	if _, err := encodeText("x", "windows-1252"); err == nil {
		t.Fatal("wrote Windows-1252")
	}
}
