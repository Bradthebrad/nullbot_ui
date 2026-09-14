package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
)

// Keep this per-file transport limit in sync with the core attachment reader.
const maxAttachmentBytes int64 = 20 * 1024 * 1024
const maxAttachmentImagePixels int64 = 16 * 1024 * 1024
const attachmentThumbnailSide = 256

// AttachBytes imports browser File contents. dataBase64 is standard, padded base64,
// not a data URL. On failure no token or staged file is returned. PNG/JPEG/GIF
// previews are validated, single-frame PNG thumbnails (at most 256x256).
func (a *App) AttachBytes(name string, dataBase64 string) (AttachmentInfo, error) {
	if err := validateAttachmentName(name); err != nil {
		return AttachmentInfo{}, err
	}
	if int64(len(dataBase64)) > ((maxAttachmentBytes+2)/3)*4 {
		return AttachmentInfo{}, fmt.Errorf("attachment exceeds the 20 MiB per-file limit")
	}
	reader := base64.NewDecoder(base64.StdEncoding.Strict(), strings.NewReader(dataBase64))
	info, err := a.stageAttachment(name, reader)
	if err != nil {
		return AttachmentInfo{}, fmt.Errorf("attach %q (expected standard base64 file contents): %w", name, err)
	}
	return info, nil
}

func validateAttachmentName(name string) error {
	if name == "" || strings.TrimSpace(name) != name || name == "." || name == ".." || len(name) > 240 ||
		strings.ContainsAny(name, `/\<>:"|?*`) || strings.HasSuffix(name, ".") {
		return fmt.Errorf("attachment name must be a simple filename, not a path or Windows device name")
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return fmt.Errorf("attachment name contains a control character")
		}
	}
	stem := strings.ToUpper(strings.SplitN(name, ".", 2)[0])
	device := []rune(stem)
	if stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" || stem == "CLOCK$" ||
		(len(device) == 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) && strings.ContainsRune("123456789¹²³", device[3])) {
		return fmt.Errorf("attachment name is a reserved Windows device name")
	}
	return nil
}

func (a *App) attachFile(source string) AttachmentInfo {
	info, err := a.importAttachmentFile(source)
	if err != nil {
		return AttachmentInfo{OriginalPath: source, Name: filepath.Base(source), Error: err.Error()}
	}
	info.OriginalPath = source
	return info
}

func (a *App) copyAttachmentIntoWorkspace(source string) (string, error) {
	info, err := a.importAttachmentFile(source)
	return info.Path, err
}

func (a *App) importAttachmentFile(source string) (AttachmentInfo, error) {
	if a.bot == nil {
		return AttachmentInfo{}, fmt.Errorf("attachment service is not initialized")
	}
	source, err := filepath.Abs(filepath.Clean(source))
	if err != nil {
		return AttachmentInfo{}, err
	}
	if err := validateAttachmentName(filepath.Base(source)); err != nil {
		return AttachmentInfo{}, err
	}
	// Explicitly selected external files may be imported, but this additional
	// read grant must not override a denied/invalid configured project. The
	// shared policy applies the most restrictive overlapping grant.
	config := a.bot.Config()
	if err := checkAttachmentSource(config, source); err != nil {
		return AttachmentInfo{}, fmt.Errorf("attachment source denied: %w", err)
	}
	stat, err := os.Stat(source)
	if err != nil {
		return AttachmentInfo{}, err
	}
	if err := checkAttachmentFile(stat); err != nil {
		return AttachmentInfo{}, err
	}
	in, err := os.Open(source)
	if err != nil {
		return AttachmentInfo{}, err
	}
	defer in.Close()
	opened, err := in.Stat()
	if err != nil {
		return AttachmentInfo{}, err
	}
	if err := checkAttachmentFile(opened); err != nil {
		return AttachmentInfo{}, err
	}
	if !os.SameFile(stat, opened) {
		return AttachmentInfo{}, fmt.Errorf("attachment source changed while opening")
	}
	return a.stageAttachment(filepath.Base(source), in)
}

func checkAttachmentSource(config nullbot.Config, source string) error {
	projects := append([]nullbot.Project(nil), config.Projects...)
	if len(projects) == 0 {
		projects = []nullbot.Project{{Path: config.WorkspaceDir, Permission: "read-only"}}
	}
	// Check lexical containment too: resolving a link must not turn a source
	// inside a denied project into an apparently external import.
	for _, p := range projects {
		root, err := filepath.Abs(p.Path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, source)
		inside := err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
		if inside && p.Permission != "read-only" && p.Permission != "read-write" && p.Permission != "full" {
			return fmt.Errorf("invalid or denied project permission for %s", p.Name)
		}
	}
	config.Projects = append(projects, nullbot.Project{ID: "selected-attachment-source", Path: filepath.Dir(source), Permission: "read-only"})
	_, err := checkUIProjectPath(config, source, false, false)
	return err
}

func checkAttachmentFile(info os.FileInfo) error {
	if !info.Mode().IsRegular() {
		return fmt.Errorf("only regular files can be attached")
	}
	if info.Size() > maxAttachmentBytes {
		return fmt.Errorf("attachment exceeds the 20 MiB per-file limit")
	}
	return nil
}

func (a *App) stageAttachment(name string, in io.Reader) (info AttachmentInfo, err error) {
	if a.bot == nil {
		return info, fmt.Errorf("attachment service is not initialized")
	}
	if err := validateAttachmentName(name); err != nil {
		return info, err
	}
	config := a.bot.Config()
	workspace := strings.TrimSpace(config.WorkspaceDir)
	if workspace == "" {
		workspace = "."
	}
	workspace, err = filepath.Abs(workspace)
	if err != nil {
		return info, err
	}
	root, err := checkUIProjectPath(config, filepath.Join(workspace, ".nullbot", "attachments"), true, false)
	if err != nil {
		return info, err
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return info, err
	}
	root, err = checkUIProjectPath(config, root, true, false)
	if err != nil {
		return info, err
	}
	// A private, unpredictable directory and exclusive creation prevent collisions
	// and overwrites. Remove the entire per-import directory on any failure.
	dir, err := os.MkdirTemp(root, "import-")
	if err != nil {
		return info, err
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(dir)
		}
	}()
	dest, err := checkUIProjectPath(config, filepath.Join(dir, name), true, false)
	if err != nil {
		return info, err
	}
	if err = writeBoundedAttachment(in, dest); err != nil {
		return info, err
	}
	preview, err := attachmentPreview(dest)
	if err != nil {
		return info, err
	}
	stat, err := os.Stat(dest)
	if err != nil {
		return info, err
	}
	return AttachmentInfo{Name: name, Path: dest, Token: attachmentToken(dest), Kind: fileKind(name), Size: stat.Size(), PreviewURL: preview}, nil
}

func writeBoundedAttachment(in io.Reader, dest string) (err error) {
	out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer func() {
		closeErr := out.Close()
		if err == nil {
			err = closeErr
		}
		if err != nil {
			_ = os.Remove(dest)
		}
	}()
	n, err := io.Copy(out, io.LimitReader(in, maxAttachmentBytes+1))
	if err != nil {
		return fmt.Errorf("read attachment: %w", err)
	}
	if n > maxAttachmentBytes {
		return fmt.Errorf("attachment exceeds the 20 MiB per-file limit")
	}
	return nil
}

// copyFile is retained as a bounded, non-overwriting attachment copy helper.
func copyFile(source, dest string) error {
	stat, err := os.Stat(source)
	if err != nil {
		return err
	}
	if err := checkAttachmentFile(stat); err != nil {
		return err
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	opened, err := in.Stat()
	if err != nil {
		return err
	}
	if err := checkAttachmentFile(opened); err != nil {
		return err
	}
	if !os.SameFile(stat, opened) {
		return fmt.Errorf("attachment source changed while opening")
	}
	return writeBoundedAttachment(in, dest)
}

func attachmentPreview(path string) (string, error) {
	var expected string
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png":
		expected = "png"
	case ".jpg", ".jpeg":
		expected = "jpeg"
	case ".gif":
		expected = "gif"
	default:
		// Never pass through SVG, HTML, or arbitrary image bytes to the webview.
		return "", nil
	}
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	config, format, err := image.DecodeConfig(io.LimitReader(file, maxAttachmentBytes+1))
	if err != nil || format != expected {
		return "", fmt.Errorf("invalid %s image or content does not match its filename", expected)
	}
	if config.Width <= 0 || config.Height <= 0 || int64(config.Width) > maxAttachmentImagePixels/int64(config.Height) {
		return "", fmt.Errorf("image dimensions exceed the 16 megapixel preview safety limit")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	img, _, err := image.Decode(io.LimitReader(file, maxAttachmentBytes+1))
	if err != nil {
		return "", fmt.Errorf("invalid %s image: %w", expected, err)
	}
	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	if w != config.Width || h != config.Height {
		return "", fmt.Errorf("image dimensions changed during decoding")
	}
	tw, th := w, h
	if tw > attachmentThumbnailSide || th > attachmentThumbnailSide {
		if w >= h {
			tw, th = attachmentThumbnailSide, max(1, h*attachmentThumbnailSide/w)
		} else {
			tw, th = max(1, w*attachmentThumbnailSide/h), attachmentThumbnailSide
		}
	}
	thumb := image.NewNRGBA(image.Rect(0, 0, tw, th))
	for y := 0; y < th; y++ {
		for x := 0; x < tw; x++ {
			thumb.Set(x, y, img.At(bounds.Min.X+x*w/tw, bounds.Min.Y+y*h/th))
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, thumb); err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(encoded.Bytes()), nil
}

func attachmentToken(path string) string {
	return fmt.Sprintf("@file(%q)", filepath.ToSlash(filepath.Clean(path)))
}

// Parse a path-only clipboard payload, never pick incidental filenames out of
// prose. Quotes group Windows paths without interpreting backslashes as escapes.
func attachmentPathsFromText(text string) []string {
	text = strings.TrimSpace(text)
	if text == "" || strings.Contains(text, "@file(") {
		return nil
	}
	if path, ok := attachmentPath(text); ok {
		return []string{path}
	}
	var paths []string
	for len(text) > 0 {
		var candidate string
		if strings.ContainsRune("\"'`", rune(text[0])) {
			quote := text[0]
			end := strings.IndexByte(text[1:], quote)
			if end < 0 {
				return nil
			}
			candidate, text = text[1:end+1], text[end+2:]
			if text != "" && !unicode.IsSpace([]rune(text)[0]) {
				return nil
			}
		} else {
			// A newline-delimited unquoted path may itself contain spaces.
			end := strings.IndexAny(text, "\r\n")
			if end < 0 {
				end = len(text)
			}
			line := strings.TrimSpace(text[:end])
			if _, ok := attachmentPath(line); ok {
				candidate, text = line, text[end:]
			} else {
				end = strings.IndexFunc(text, unicode.IsSpace)
				if end < 0 {
					end = len(text)
				}
				candidate, text = text[:end], text[end:]
			}
		}
		path, ok := attachmentPath(candidate)
		if !ok {
			return nil
		}
		paths = append(paths, path)
		text = strings.TrimSpace(text)
	}
	return paths
}

func attachmentPath(path string) (string, bool) {
	if path == "" || strings.HasPrefix(path, "@file(") {
		return "", false
	}
	if err := validateAttachmentName(filepath.Base(path)); err != nil {
		return "", false
	}
	if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() {
		return filepath.Clean(path), true
	}
	return "", false
}
