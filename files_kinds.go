package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"
)

// Previews read untrusted files, so every reader is bounded: what it may
// decompress, how much text it keeps, and how long it may take.
const (
	maxZipEntryBytes  = 32 << 20 // decompressed bytes read from one zip entry
	maxExtractedText  = 400_000  // characters of text kept from a document
	maxArchiveScan    = 256 << 20
	maxArchiveTime    = 3 * time.Second
	maxRenderedHTML   = 5 << 20
	maxFormattedJSON  = 512 << 10
	maxJSONDepthShown = 40
)

// openZipEntry opens a zip entry for reading at most maxZipEntryBytes, so a
// small file can't expand into gigabytes.
func openZipEntry(file *zip.File) (io.ReadCloser, error) {
	rc, err := file.Open()
	if err != nil {
		return nil, err
	}
	return struct {
		io.Reader
		io.Closer
	}{io.LimitReader(rc, maxZipEntryBytes), rc}, nil
}

// File kinds decide the icon in the list and how a file previews.
//
//	markdown, text, code, json, data (JSON lines), csv, html  text, editable
//	xlsx, ods                                               first sheet as a table
//	docx, odt, rtf, pptx, odp                               text extracted
//	pdf, image, audio, video, font                          streamed to the viewer
//	archive                                                 list of entries
//	binary                                                  size and a hex dump of the start
var kindByExt = map[string]string{}

func init() {
	add := func(kind string, exts ...string) {
		for _, ext := range exts {
			kindByExt[ext] = kind
		}
	}
	add("markdown", ".md", ".markdown", ".mdown", ".mkd", ".mdx")
	add("text", ".txt", ".log", ".out", ".err", ".ini", ".env", ".cfg", ".conf", ".properties", ".rst", ".adoc", ".asciidoc",
		".tex", ".bib", ".srt", ".vtt", ".diff", ".patch", ".csr", ".pem", ".crt", ".cer", ".pub", ".gitignore", ".gitattributes",
		".editorconfig", ".npmrc", ".nvmrc", ".dockerignore", ".lock", ".sum", ".mod", ".org", ".nfo", ".me", ".list", ".text")
	add("code", ".go", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro",
		".py", ".pyi", ".pyw", ".ipynb", ".rb", ".php", ".pl", ".pm", ".lua", ".r", ".jl", ".dart", ".swift", ".kt", ".kts",
		".java", ".scala", ".groovy", ".gradle", ".clj", ".cljs", ".edn", ".ex", ".exs", ".erl", ".hrl", ".hs", ".elm", ".ml", ".mli", ".fs", ".fsx", ".nim", ".zig", ".v",
		".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx", ".m", ".mm", ".cs", ".csx", ".vb", ".rs", ".sol", ".asm", ".s",
		".sql", ".graphql", ".gql", ".proto", ".thrift", ".prisma",
		".sh", ".bash", ".zsh", ".fish", ".ps1", ".psm1", ".psd1", ".bat", ".cmd", ".awk", ".sed",
		".css", ".scss", ".sass", ".less", ".styl",
		".yaml", ".yml", ".toml", ".xml", ".xsd", ".xsl", ".xslt", ".plist", ".csproj", ".vbproj", ".sln", ".props", ".targets", ".resx",
		".tf", ".tfvars", ".hcl", ".nix", ".cmake", ".mk", ".make", ".dockerfile", ".bicep", ".kql", ".http", ".rest")
	add("json", ".json", ".jsonc", ".json5", ".geojson", ".har", ".webmanifest", ".map")
	add("data", ".jsonl", ".ndjson")
	add("csv", ".csv", ".tsv", ".tab", ".psv")
	add("html", ".html", ".htm", ".xhtml")
	add("xlsx", ".xlsx", ".xlsm")
	add("ods", ".ods")
	add("docx", ".docx", ".docm", ".dotx")
	add("odt", ".odt")
	add("rtf", ".rtf")
	add("pptx", ".pptx", ".pptm", ".ppsx")
	add("odp", ".odp")
	add("pdf", ".pdf")
	add("drawio", ".drawio", ".dio")
	add("image", ".png", ".jpg", ".jpeg", ".jfif", ".gif", ".webp", ".bmp", ".svg", ".ico", ".avif", ".apng")
	add("audio", ".mp3", ".wav", ".ogg", ".oga", ".m4a", ".aac", ".flac", ".opus", ".weba")
	add("video", ".mp4", ".m4v", ".webm", ".ogv", ".mov")
	add("font", ".ttf", ".otf", ".woff", ".woff2")
	add("archive", ".zip", ".jar", ".war", ".apk", ".epub", ".nupkg", ".vsix", ".whl", ".tar", ".gz", ".tgz", ".7z", ".rar", ".bz2", ".xz", ".zst", ".cab", ".iso")
	add("binary", ".exe", ".dll", ".so", ".dylib", ".msi", ".bin", ".dat", ".db", ".sqlite", ".sqlite3", ".mdb", ".accdb", ".class", ".o", ".obj", ".lib", ".a", ".pyc", ".wasm", ".doc", ".xls", ".ppt", ".psd", ".ai", ".sketch", ".fig", ".tif", ".tiff", ".heic", ".raw", ".dmg", ".pkg", ".deb", ".rpm")
}

// Files known by name rather than extension.
var kindByName = map[string]string{
	"dockerfile": "code", "containerfile": "code", "makefile": "code", "gnumakefile": "code", "justfile": "code", "rakefile": "code",
	"gemfile": "code", "procfile": "code", "vagrantfile": "code", "jenkinsfile": "code", "brewfile": "code", "caddyfile": "code",
	"readme": "text", "license": "text", "licence": "text", "copying": "text", "authors": "text", "contributors": "text",
	"changelog": "text", "notice": "text", "todo": "text", "codeowners": "text", "go.mod": "text", "go.sum": "text",
}

func fileKind(path string) string {
	name := strings.ToLower(filepath.Base(path))
	if kind, ok := kindByName[name]; ok {
		return kind
	}
	if strings.HasSuffix(name, ".tar.gz") || strings.HasSuffix(name, ".tar.bz2") || strings.HasSuffix(name, ".tar.xz") {
		return "archive"
	}
	if kind, ok := kindByExt[strings.ToLower(filepath.Ext(name))]; ok {
		return kind
	}
	if strings.HasPrefix(name, ".") && !strings.Contains(name[1:], ".") {
		return "text" // .bashrc, .npmrc and other dotfiles
	}
	return "binary"
}

// textKinds preview as text and can be edited in place.
var textKinds = map[string]bool{"markdown": true, "text": true, "code": true, "json": true, "data": true, "csv": true, "html": true}

func isEditableKind(kind, _ string, size int64) bool {
	return size <= maxPreviewBytes && textKinds[kind]
}

var mimeByKind = map[string]string{"pdf": "application/pdf"}

// fileMIME is the content type a preview is served with.
func fileMIME(path, kind string) string {
	if m, ok := mimeByKind[kind]; ok {
		return m
	}
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".mov":
		return "video/mp4" // QuickTime H.264 plays in the WebView only as MP4
	case ".m4a":
		return "audio/mp4"
	case ".opus":
		return "audio/ogg"
	case ".woff2":
		return "font/woff2"
	case ".ico":
		return "image/x-icon"
	case ".avif":
		return "image/avif"
	}
	if m := mime.TypeByExtension(ext); m != "" {
		return m
	}
	return "application/octet-stream"
}

// previewFile previews a path the caller has already authorized.
func (a *App) previewFile(path string) (FilePreview, error) {
	path, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return FilePreview{}, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return FilePreview{}, err
	}
	if info.IsDir() {
		return FilePreview{}, fmt.Errorf("%s is a directory", path)
	}
	kind := fileKind(path)
	preview := FilePreview{
		Path:     path,
		Name:     filepath.Base(path),
		Kind:     kind,
		MIME:     fileMIME(path, kind),
		Size:     info.Size(),
		Modified: info.ModTime(),
		Editable: isEditableKind(kind, "", info.Size()),
	}
	switch kind {
	case "image", "pdf", "audio", "video", "font":
		// Streamed by the asset server by token; no base64 copy over IPC.
		if info.Size() > maxStreamPreviewBytes {
			preview.Error = "This file is too large to preview. Use Open to view it."
			return preview, nil
		}
		preview.URL = a.registerLocal(path, preview.MIME)
		preview.DataURL = preview.URL
		if kind == "image" && strings.EqualFold(filepath.Ext(path), ".svg") {
			preview.Content, preview.Truncated, _ = readTextPreview(path)
		}
	case "html":
		a.textPreview(&preview, path)
		// The rendered view loads only the file itself: the server's policy
		// blocks scripts and anything from the network. Very large pages
		// show as source only.
		if info.Size() <= maxRenderedHTML {
			preview.URL = a.registerLocal(path, "text/html; charset=utf-8")
		}
	case "csv":
		a.textPreview(&preview, path)
		preview.Headers, preview.Rows = parseDelimitedRows(preview.Content, path)
	case "json":
		a.textPreview(&preview, path)
		preview.Formatted = formatJSON(preview.Content, preview.Truncated)
	case "markdown", "text", "code", "data":
		a.textPreview(&preview, path)
	case "xlsx":
		headers, rows, err := parseXLSXPreview(path)
		if err != nil {
			preview.Error = "Couldn’t read this spreadsheet: " + err.Error()
			return preview, nil
		}
		preview.Headers, preview.Rows = headers, rows
	case "ods":
		headers, rows, err := parseODSPreview(path)
		if err != nil {
			preview.Error = "Couldn’t read this spreadsheet: " + err.Error()
			return preview, nil
		}
		preview.Headers, preview.Rows = headers, rows
	case "docx", "odt", "rtf", "pptx", "odp":
		text, err := extractDocumentText(path, kind)
		if err != nil {
			preview.Error = "Couldn’t read this document: " + err.Error()
			return preview, nil
		}
		preview.Content = truncateRunes(text, 60000)
		preview.Truncated = utf8.RuneCountInString(text) > 60000
	case "drawio":
		// Drawn here as a picture of its first page.
		data, err := readLimited(path, maxDrawioBytes)
		if err == nil {
			var pages []drawioPage
			if pages, err = drawioPages(data); err == nil {
				preview.DataURL = "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(pages[0].SVG))
				preview.Count = len(pages)
				preview.Content = pages[0].Name
			}
		}
		if err != nil {
			preview.Error = "Couldn’t draw this diagram: " + err.Error()
		}
	case "archive":
		entries, total, err := listArchive(path)
		if err != nil {
			preview.Error = "Can’t list this archive here (" + err.Error() + "). Use Open to view it."
			return preview, nil
		}
		preview.Entries = entries
		preview.Truncated = total > len(entries)
		preview.Count = total
	default:
		// Unknown extension: show it as text if it is text, else a hex dump.
		content, truncated, err := readTextPreview(path)
		if err == nil && looksLikeText(content) {
			preview.Kind = "text"
			preview.Editable = info.Size() <= maxPreviewBytes
			preview.Content, preview.Truncated = content, truncated
			return preview, nil
		}
		preview.Kind = "binary"
		preview.Hex = hexDump(path, 1024)
	}
	return preview, nil
}

// formatJSON indents JSON for reading, keeping key order. Large or deeply
// nested documents are left as they are: indentation multiplies their size.
func formatJSON(content string, truncated bool) string {
	if content == "" || truncated || len(content) > maxFormattedJSON || jsonDepth(content) > maxJSONDepthShown {
		return ""
	}
	var out bytes.Buffer
	if err := json.Indent(&out, []byte(content), "", "  "); err != nil || out.Len() > 4*maxFormattedJSON || out.String() == content {
		return ""
	}
	return out.String()
}

func jsonDepth(content string) int {
	depth, deepest, inString, escaped := 0, 0, false, false
	for i := 0; i < len(content); i++ {
		c := content[i]
		switch {
		case escaped:
			escaped = false
		case inString && c == '\\':
			escaped = true
		case c == '"':
			inString = !inString
		case inString:
		case c == '{' || c == '[':
			depth++
			if depth > deepest {
				deepest = depth
			}
		case c == '}' || c == ']':
			depth--
		}
	}
	return deepest
}

func (a *App) registerLocal(path, mimeType string) string {
	if a.localFiles == nil {
		a.localFiles = newLocalFiles()
	}
	return a.localFiles.register(path, mimeType)
}

func (a *App) textPreview(preview *FilePreview, path string) {
	content, truncated, encoding, err := readTextFile(path)
	if err != nil {
		preview.Error = err.Error()
		preview.Editable = false
		return
	}
	preview.Content, preview.Truncated, preview.Encoding = content, truncated, encoding
	switch {
	case truncated:
		preview.Editable = false
		preview.ReadOnlyReason = "Too large to edit here"
	case encoding == "windows-1252":
		// Saving would have to change its encoding; leave that to its app.
		preview.Editable = false
		preview.ReadOnlyReason = "Stored as Windows-1252 text; edit it in another app to keep that encoding"
	}
}

// readTextPreview reads up to maxPreviewBytes as text. It understands
// UTF-8 (with or without a byte order mark) and UTF-16, which Windows tools
// often write; anything else is read as Windows-1252.
func readTextPreview(path string) (string, bool, error) {
	content, truncated, _, err := readTextFile(path)
	return content, truncated, err
}

// readTextFile is readTextPreview that also reports the encoding.
func readTextFile(path string) (string, bool, string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", false, "", err
	}
	defer file.Close()
	var buf bytes.Buffer
	n, err := io.CopyN(&buf, file, maxPreviewBytes+1)
	if err != nil && err != io.EOF {
		return "", false, "", err
	}
	data := buf.Bytes()
	truncated := n > maxPreviewBytes
	if truncated {
		data = data[:maxPreviewBytes]
	}
	text, encoding := decodeText(data, truncated)
	return text, truncated, encoding, nil
}

// decodeText reads data as text. cut says data stops partway through the
// file, so a multi-byte character may be split at its end.
func decodeText(data []byte, cut bool) (string, string) {
	switch {
	case bytes.HasPrefix(data, []byte{0xEF, 0xBB, 0xBF}):
		return strings.ToValidUTF8(string(data[3:]), "�"), "utf-8-bom"
	case bytes.HasPrefix(data, []byte{0xFF, 0xFE}):
		return decodeUTF16(data[2:], binary.LittleEndian), "utf-16le"
	case bytes.HasPrefix(data, []byte{0xFE, 0xFF}):
		return decodeUTF16(data[2:], binary.BigEndian), "utf-16be"
	}
	if utf8.Valid(data) {
		return string(data), "utf-8"
	}
	// A character split by the cut is still UTF-8.
	if end := lastValidUTF8(data); cut && len(data)-end < utf8.UTFMax && utf8.Valid(data[:end]) {
		return string(data[:end]), "utf-8"
	}
	return decodeWindows1252(data), "windows-1252"
}

// encodeText stores edited text the way the file was stored.
func encodeText(content, encoding string) ([]byte, error) {
	switch encoding {
	case "", "utf-8":
		return []byte(content), nil
	case "utf-8-bom":
		return append([]byte{0xEF, 0xBB, 0xBF}, content...), nil
	case "utf-16le", "utf-16be":
		var order binary.AppendByteOrder = binary.LittleEndian
		out := []byte{0xFF, 0xFE}
		if encoding == "utf-16be" {
			order, out = binary.BigEndian, []byte{0xFE, 0xFF}
		}
		for _, unit := range utf16.Encode([]rune(content)) {
			out = order.AppendUint16(out, unit)
		}
		return out, nil
	default:
		return nil, fmt.Errorf("this file is stored as %s, which the built-in editor can't write", encoding)
	}
}

func lastValidUTF8(data []byte) int {
	for i := len(data); i > 0 && i > len(data)-utf8.UTFMax; i-- {
		if utf8.RuneStart(data[i-1]) {
			return i - 1
		}
	}
	return len(data)
}

func decodeUTF16(data []byte, order binary.ByteOrder) string {
	units := make([]uint16, 0, len(data)/2)
	for i := 0; i+1 < len(data); i += 2 {
		units = append(units, order.Uint16(data[i:]))
	}
	return string(utf16.Decode(units))
}

// cp1252 maps the bytes 0x80–0x9F that differ from Latin-1.
var cp1252 = [32]rune{'€', '�', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '�', 'Ž', '�',
	'�', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '�', 'ž', 'Ÿ'}

func decodeWindows1252(data []byte) string {
	var b strings.Builder
	b.Grow(len(data))
	for _, c := range data {
		switch {
		case c < 0x80:
			b.WriteByte(c)
		case c < 0xA0:
			b.WriteRune(cp1252[c-0x80])
		default:
			b.WriteRune(rune(c))
		}
	}
	return b.String()
}

// looksLikeText rejects content with NUL bytes or many control characters.
func looksLikeText(content string) bool {
	if content == "" {
		return true
	}
	control := 0
	total := 0
	for _, r := range content {
		total++
		if r == 0 {
			return false
		}
		if r < 0x20 && r != '\n' && r != '\r' && r != '\t' && r != '\f' {
			control++
		}
		if total > 8192 {
			break
		}
	}
	return control*100 < total*2
}

func hexDump(path string, limit int) string {
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()
	data := make([]byte, limit)
	n, _ := io.ReadFull(file, data)
	data = data[:n]
	var b strings.Builder
	for offset := 0; offset < len(data); offset += 16 {
		end := offset + 16
		if end > len(data) {
			end = len(data)
		}
		fmt.Fprintf(&b, "%08x  ", offset)
		for i := offset; i < offset+16; i++ {
			if i < end {
				fmt.Fprintf(&b, "%02x ", data[i])
			} else {
				b.WriteString("   ")
			}
			if i == offset+7 {
				b.WriteByte(' ')
			}
		}
		b.WriteString(" |")
		for _, c := range data[offset:end] {
			if c >= 0x20 && c < 0x7F {
				b.WriteByte(c)
			} else {
				b.WriteByte('.')
			}
		}
		b.WriteString("|\n")
	}
	return b.String()
}

// parseDelimitedRows reads CSV, TSV and pipe-separated files.
func parseDelimitedRows(content, path string) ([]string, [][]string) {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".tsv", ".tab":
		return parseRowsWith(content, '\t')
	case ".psv":
		return parseRowsWith(content, '|')
	}
	// Guess semicolons, common in European exports, when there are no commas.
	firstLine, _, _ := strings.Cut(content, "\n")
	if !strings.Contains(firstLine, ",") && strings.Count(firstLine, ";") > 0 {
		return parseRowsWith(content, ';')
	}
	return parseCSVRows(content)
}

// ArchiveEntry is one file in an archive listing.
type ArchiveEntry struct {
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	IsDir bool   `json:"is_dir,omitempty"`
}

const maxArchiveEntries = 1000

// listArchive lists zip-based and tar archives.
func listArchive(path string) ([]ArchiveEntry, int, error) {
	lower := strings.ToLower(path)
	switch {
	case strings.HasSuffix(lower, ".tar"):
		file, err := os.Open(path)
		if err != nil {
			return nil, 0, err
		}
		defer file.Close()
		return listTar(file)
	case strings.HasSuffix(lower, ".tgz") || strings.HasSuffix(lower, ".tar.gz"):
		file, err := os.Open(path)
		if err != nil {
			return nil, 0, err
		}
		defer file.Close()
		gz, err := gzip.NewReader(file)
		if err != nil {
			return nil, 0, err
		}
		defer gz.Close()
		// Listing a compressed tar means reading through it: bounded.
		return listTar(io.LimitReader(gz, maxArchiveScan))
	case strings.HasSuffix(lower, ".gz"):
		file, err := os.Open(path)
		if err != nil {
			return nil, 0, err
		}
		defer file.Close()
		gz, err := gzip.NewReader(file)
		if err != nil {
			return nil, 0, err
		}
		name := gz.Name
		gz.Close()
		if name == "" {
			name = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
		}
		// The unpacked size (modulo 4 GiB) is in the last four bytes; nothing
		// needs decompressing.
		var size int64
		if info, err := file.Stat(); err == nil && info.Size() >= 4 {
			trailer := make([]byte, 4)
			if _, err := file.ReadAt(trailer, info.Size()-4); err == nil {
				size = int64(binary.LittleEndian.Uint32(trailer))
			}
		}
		return []ArchiveEntry{{Name: name, Size: size}}, 1, nil
	}
	zr, err := zip.OpenReader(path)
	if err != nil {
		return nil, 0, fmt.Errorf("not a format NullBot can read")
	}
	defer zr.Close()
	out := make([]ArchiveEntry, 0, minInt(len(zr.File), maxArchiveEntries))
	for _, f := range zr.File {
		if len(out) == maxArchiveEntries {
			break
		}
		out = append(out, ArchiveEntry{Name: f.Name, Size: int64(f.UncompressedSize64), IsDir: f.FileInfo().IsDir()})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, len(zr.File), nil
}

func listTar(r io.Reader) ([]ArchiveEntry, int, error) {
	tr := tar.NewReader(r)
	var out []ArchiveEntry
	total := 0
	deadline := time.Now().Add(maxArchiveTime)
	for time.Now().Before(deadline) && total < 50_000 {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			if total > 0 {
				break
			}
			return nil, 0, err
		}
		total++
		if len(out) < maxArchiveEntries {
			out = append(out, ArchiveEntry{Name: header.Name, Size: header.Size, IsDir: header.Typeflag == tar.TypeDir})
		}
	}
	return out, total, nil
}

// extractDocumentText pulls the text out of Office and OpenDocument files.
func extractDocumentText(path, kind string) (string, error) {
	switch kind {
	case "docx":
		return extractDocxText(path)
	case "rtf":
		file, err := os.Open(path)
		if err != nil {
			return "", err
		}
		defer file.Close()
		// Text sits near the start; pictures and fonts make up the bulk.
		data, err := io.ReadAll(io.LimitReader(file, 8<<20))
		if err != nil {
			return "", err
		}
		return truncateRunes(rtfText(string(data)), maxExtractedText), nil
	}
	zr, err := zip.OpenReader(path)
	if err != nil {
		return "", err
	}
	defer zr.Close()
	switch kind {
	case "pptx":
		var slides []*zip.File
		for _, f := range zr.File {
			if strings.HasPrefix(f.Name, "ppt/slides/slide") && strings.HasSuffix(f.Name, ".xml") {
				slides = append(slides, f)
			}
		}
		sort.Slice(slides, func(i, j int) bool { return slideNumber(slides[i].Name) < slideNumber(slides[j].Name) })
		var b strings.Builder
		for i, slide := range slides {
			if b.Len() > maxExtractedText || i >= 500 {
				break
			}
			text, err := xmlText(slide, map[string]bool{"t": true}, map[string]bool{"p": true})
			if err != nil {
				continue
			}
			fmt.Fprintf(&b, "Slide %d\n%s\n\n", i+1, strings.TrimSpace(text))
		}
		return strings.TrimSpace(b.String()), nil
	default: // odt, odp: OpenDocument keeps text in content.xml
		file := zipFileByName(zr.File, "content.xml")
		if file == nil {
			return "", fmt.Errorf("content.xml not found")
		}
		text, err := xmlText(file, nil, map[string]bool{"p": true, "h": true, "page": true})
		return strings.TrimSpace(text), err
	}
}

var slideNumberPattern = regexp.MustCompile(`(\d+)\.xml$`)

func slideNumber(name string) int {
	var n int
	if m := slideNumberPattern.FindStringSubmatch(name); m != nil {
		fmt.Sscan(m[1], &n)
	}
	return n
}

// xmlText collects character data. With textElements set, only text inside
// those elements counts; breaks end each listed block element.
func xmlText(file *zip.File, textElements, breaks map[string]bool) (string, error) {
	rc, err := openZipEntry(file)
	if err != nil {
		return "", err
	}
	defer rc.Close()
	decoder := xml.NewDecoder(rc)
	var b strings.Builder
	depth := 0
	for b.Len() < maxExtractedText {
		tok, err := decoder.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if textElements[t.Name.Local] {
				depth++
			}
			switch t.Name.Local {
			case "tab":
				b.WriteByte('\t')
			case "line-break", "br":
				b.WriteByte('\n')
			case "s":
				b.WriteByte(' ')
			}
		case xml.EndElement:
			if textElements[t.Name.Local] {
				depth--
			}
			if breaks[t.Name.Local] {
				b.WriteString("\n")
			}
		case xml.CharData:
			if textElements == nil || depth > 0 {
				b.Write(t)
			}
		}
	}
	return b.String(), nil
}

// parseODSPreview reads the first sheet of an OpenDocument spreadsheet.
func parseODSPreview(path string) ([]string, [][]string, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return nil, nil, err
	}
	defer zr.Close()
	file := zipFileByName(zr.File, "content.xml")
	if file == nil {
		return nil, nil, fmt.Errorf("content.xml not found")
	}
	rc, err := openZipEntry(file)
	if err != nil {
		return nil, nil, err
	}
	defer rc.Close()
	decoder := xml.NewDecoder(rc)
	var rows [][]string
	var row []string
	var cell strings.Builder
	inCell, tables := false, 0
	repeat := 1
	for len(rows) < 201 {
		tok, err := decoder.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "table":
				tables++
			case "table-row":
				row = nil
			case "table-cell", "covered-table-cell":
				inCell, repeat = true, 1
				cell.Reset()
				for _, attr := range t.Attr {
					if attr.Name.Local == "number-columns-repeated" {
						fmt.Sscan(attr.Value, &repeat)
					}
				}
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "table":
				if tables == 1 {
					return odsHeaders(rows)
				}
			case "table-row":
				if tables == 1 {
					for len(row) > 0 && row[len(row)-1] == "" {
						row = row[:len(row)-1]
					}
					if len(row) > 0 {
						rows = append(rows, row)
					}
				}
			case "table-cell", "covered-table-cell":
				for i := 0; i < repeat && i < 64 && len(row) < 200; i++ {
					row = append(row, truncateRunes(strings.TrimSpace(cell.String()), 2000))
				}
				inCell = false
			case "p":
				if inCell {
					cell.WriteByte('\n')
				}
			}
		case xml.CharData:
			if inCell && cell.Len() < 8000 {
				cell.Write(t)
			}
		}
	}
	return odsHeaders(rows)
}

func odsHeaders(rows [][]string) ([]string, [][]string, error) {
	if len(rows) == 0 {
		return nil, nil, fmt.Errorf("the first sheet is empty")
	}
	width := 0
	for _, row := range rows {
		width = maxInt(width, len(row))
	}
	headers := append([]string(nil), rows[0]...)
	for len(headers) < width {
		headers = append(headers, "")
	}
	return headers, rows[1:], nil
}

// rtfText strips RTF control words and groups, keeping the text.
func rtfText(rtf string) string {
	var b strings.Builder
	depth, skipDepth := 0, -1
	for i := 0; i < len(rtf); i++ {
		c := rtf[i]
		switch c {
		case '{':
			depth++
		case '}':
			if depth == skipDepth {
				skipDepth = -1
			}
			depth--
		case '\\':
			if i+1 < len(rtf) && (rtf[i+1] == '\\' || rtf[i+1] == '{' || rtf[i+1] == '}') {
				if skipDepth < 0 {
					b.WriteByte(rtf[i+1])
				}
				i++
				continue
			}
			if i+1 < len(rtf) && rtf[i+1] == '\'' && i+3 < len(rtf) {
				var v byte
				fmt.Sscanf(rtf[i+2:i+4], "%02x", &v)
				if skipDepth < 0 {
					b.WriteString(decodeWindows1252([]byte{v}))
				}
				i += 3
				continue
			}
			j := i + 1
			for j < len(rtf) && (rtf[j] >= 'a' && rtf[j] <= 'z' || rtf[j] >= 'A' && rtf[j] <= 'Z') {
				j++
			}
			word := rtf[i+1 : j]
			numStart := j
			for j < len(rtf) && (rtf[j] == '-' || rtf[j] >= '0' && rtf[j] <= '9') {
				j++
			}
			number := rtf[numStart:j]
			if j < len(rtf) && rtf[j] == ' ' {
				j++
			}
			switch word {
			case "u":
				var code int
				if _, err := fmt.Sscan(number, &code); err == nil && skipDepth < 0 {
					if code < 0 {
						code += 65536
					}
					b.WriteRune(rune(code))
				}
				if j < len(rtf) && rtf[j] != '\\' && rtf[j] != '{' && rtf[j] != '}' {
					j++ // the fallback character for readers without Unicode
				}
			case "par", "line", "sect", "page", "row":
				if skipDepth < 0 {
					b.WriteByte('\n')
				}
			case "tab", "cell":
				if skipDepth < 0 {
					b.WriteByte('\t')
				}
			case "fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "themedata", "colorschememapping", "latentstyles", "datastore", "xmlnstbl", "listtable", "listoverridetable", "rsidtbl", "generator":
				if skipDepth < 0 {
					skipDepth = depth
				}
			case "":
				if j < len(rtf) && rtf[j] == '*' && skipDepth < 0 {
					skipDepth = depth
				}
			}
			i = j - 1
		case '\r', '\n':
		default:
			if skipDepth < 0 {
				b.WriteByte(c)
			}
		}
	}
	return strings.TrimSpace(b.String())
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
