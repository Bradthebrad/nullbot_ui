package main

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
)

func assertNoStagedAttachments(t *testing.T, workspace string) {
	t.Helper()
	root := filepath.Join(workspace, ".nullbot", "attachments")
	entries, err := os.ReadDir(root)
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("partial attachments remain: %v", entries)
	}
}

func TestAttachBytesRoundTrip(t *testing.T) {
	c := permissionConfig(t, "read-write")
	a := permissionApp(c)
	for i := 0; i < 2; i++ {
		info, err := a.AttachBytes("clipboard.txt", base64.StdEncoding.EncodeToString([]byte("clipboard bytes")))
		if err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(info.Path)
		if err != nil || string(data) != "clipboard bytes" || info.Size != 15 || info.Name != "clipboard.txt" || info.Token != attachmentToken(info.Path) || info.PreviewURL != "" || info.Error != "" || info.OriginalPath != "" {
			t.Fatalf("bad import: %+v %q %v", info, data, err)
		}
		encoded, err := json.Marshal(info)
		if err != nil || bytes.Contains(encoded, []byte("preview_url")) {
			t.Fatalf("optional preview contract: %s %v", encoded, err)
		}
	}
	entries, err := os.ReadDir(filepath.Join(c.WorkspaceDir, ".nullbot", "attachments"))
	if err != nil || len(entries) != 2 {
		t.Fatalf("same-named imports must not overwrite: %v %v", entries, err)
	}
}

func TestAttachBytesValidationAndCleanup(t *testing.T) {
	for _, tc := range []struct{ name, data, want string }{
		{"../escape.txt", "eA==", "simple filename"},
		{`C:\escape.txt`, "eA==", "simple filename"},
		{`a\b.txt`, "eA==", "simple filename"},
		{"a/b.txt", "eA==", "simple filename"},
		{"a:stream", "eA==", "simple filename"},
		{"NUL.txt", "eA==", "reserved"},
		{"COM1", "eA==", "reserved"},
		{"trailing.", "eA==", "simple filename"},
		{"bad\nname", "eA==", "control"},
		{"", "eA==", "simple filename"},
		{"x.txt", "YQ==junk", "base64"},
		{"x.txt", "data:text/plain;base64,eA==", "base64"},
		{"x.txt", "!!!!", "base64"},
		{"x.txt", "YR==", "base64"},
		{"broken.png", base64.StdEncoding.EncodeToString([]byte("not a PNG")), "invalid png"},
	} {
		t.Run(tc.name+"_"+tc.want, func(t *testing.T) {
			c := permissionConfig(t, "read-write")
			info, err := permissionApp(c).AttachBytes(tc.name, tc.data)
			if err == nil || !strings.Contains(err.Error(), tc.want) || info.Token != "" || info.Path != "" {
				t.Fatalf("unexpected result %+v %v, want %s", info, err, tc.want)
			}
			assertNoStagedAttachments(t, c.WorkspaceDir)
		})
	}
}

func TestAttachBytesLimit(t *testing.T) {
	c := permissionConfig(t, "read-write")
	a := permissionApp(c)
	data := make([]byte, maxAttachmentBytes)
	info, err := a.AttachBytes("limit.bin", base64.StdEncoding.EncodeToString(data))
	if err != nil || info.Size != maxAttachmentBytes {
		t.Fatalf("exact limit: %+v %v", info, err)
	}
	if err := os.RemoveAll(filepath.Dir(info.Path)); err != nil {
		t.Fatal(err)
	}
	for _, extra := range []int{1, 3} {
		_, err := a.AttachBytes("over.bin", base64.StdEncoding.EncodeToString(append(data, make([]byte, extra)...)))
		if err == nil || !strings.Contains(err.Error(), "20 MiB") {
			t.Fatalf("limit+%d accepted: %v", extra, err)
		}
		assertNoStagedAttachments(t, c.WorkspaceDir)
	}
}

func TestAttachmentPreviewFormats(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 600, 300))
	img.Set(0, 0, color.NRGBA{R: 255, A: 255})
	for _, format := range []string{"png", "jpg", "gif"} {
		t.Run(format, func(t *testing.T) {
			var src bytes.Buffer
			var err error
			switch format {
			case "png":
				err = png.Encode(&src, img)
			case "jpg":
				err = jpeg.Encode(&src, img, nil)
			case "gif":
				err = gif.Encode(&src, img, nil)
			}
			if err != nil {
				t.Fatal(err)
			}
			c := permissionConfig(t, "read-write")
			info, err := permissionApp(c).AttachBytes("photo."+format, base64.StdEncoding.EncodeToString(src.Bytes()))
			if err != nil {
				t.Fatal(err)
			}
			const prefix = "data:image/png;base64,"
			if !strings.HasPrefix(info.PreviewURL, prefix) || len(info.PreviewURL) > 400000 || info.Kind != "image" {
				t.Fatalf("bad preview: %+v", info)
			}
			data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(info.PreviewURL, prefix))
			if err != nil {
				t.Fatal(err)
			}
			cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
			if err != nil || cfg.Width != 256 || cfg.Height != 128 {
				t.Fatalf("bad thumbnail dimensions: %+v %v", cfg, err)
			}
			original, err := os.ReadFile(info.Path)
			if err != nil || !bytes.Equal(original, src.Bytes()) {
				t.Fatalf("original was modified: %v", err)
			}
			encoded, _ := json.Marshal(info)
			if !bytes.Contains(encoded, []byte(`"preview_url":"data:image/png;base64,`)) {
				t.Fatal("missing JSON preview_url")
			}
		})
	}
}

func TestAttachmentPreviewRejectsBadImages(t *testing.T) {
	var pngBytes bytes.Buffer
	if err := png.Encode(&pngBytes, image.NewNRGBA(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	bomb := append([]byte(nil), pngBytes.Bytes()...)
	binary.BigEndian.PutUint32(bomb[16:20], 100000)
	binary.BigEndian.PutUint32(bomb[20:24], 100000)
	binary.BigEndian.PutUint32(bomb[29:33], crc32.ChecksumIEEE(bomb[12:29]))
	for _, tc := range []struct {
		name string
		data []byte
		want string
	}{
		{"mismatch.jpg", pngBytes.Bytes(), "invalid jpeg"},
		{"truncated.png", pngBytes.Bytes()[:40], "invalid png"},
		{"bomb.png", bomb, "dimensions"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := permissionConfig(t, "read-write")
			a := permissionApp(c)
			source := filepath.Join(t.TempDir(), tc.name)
			if err := os.WriteFile(source, tc.data, 0600); err != nil {
				t.Fatal(err)
			}
			infos, err := a.AttachFiles([]string{source})
			if err != nil || len(infos) != 1 || !strings.Contains(infos[0].Error, tc.want) || infos[0].Token != "" || infos[0].Path != "" {
				t.Fatalf("bad result: %+v %v", infos, err)
			}
			assertNoStagedAttachments(t, c.WorkspaceDir)
		})
	}
}

func TestAttachmentUnsafeFormatsHaveNoPreview(t *testing.T) {
	c := permissionConfig(t, "read-write")
	for _, name := range []string{"active.svg", "active.html", "unsupported.webp", "unsupported.bmp"} {
		info, err := permissionApp(c).AttachBytes(name, base64.StdEncoding.EncodeToString([]byte(`<svg onload="alert(1)"></svg>`)))
		if err != nil || info.PreviewURL != "" {
			t.Fatalf("unsafe preview: %+v %v", info, err)
		}
	}
}

func TestAttachBytesDestinationPermissions(t *testing.T) {
	for _, perm := range []string{"read-only", "invalid"} {
		c := permissionConfig(t, perm)
		if _, err := permissionApp(c).AttachBytes("test.txt", "eA=="); err == nil {
			t.Fatalf("%s destination allowed", perm)
		}
		if _, err := os.Stat(filepath.Join(c.WorkspaceDir, ".nullbot")); !os.IsNotExist(err) {
			t.Fatalf("created destination before authorization: %v", err)
		}
	}
	c := permissionConfig(t, "read-write")
	outside := t.TempDir()
	if err := permissionDirLink(outside, filepath.Join(c.WorkspaceDir, ".nullbot")); err != nil {
		t.Skipf("link unavailable: %v", err)
	}
	if _, err := permissionApp(c).AttachBytes("test.txt", "eA=="); err == nil {
		t.Fatal("destination link escape accepted")
	}
	entries, err := os.ReadDir(outside)
	if err != nil || len(entries) != 0 {
		t.Fatalf("escape writes: %v %v", entries, err)
	}
}

func TestAttachmentSourcePermissions(t *testing.T) {
	for _, perm := range []string{"read-only", "read-write", "full", "denied"} {
		t.Run(perm, func(t *testing.T) {
			c := permissionConfig(t, "read-write")
			sourceDir := t.TempDir()
			c.Projects = append(c.Projects, nullbot.Project{ID: "source", Name: "Source", Path: sourceDir, Permission: perm})
			source := filepath.Join(sourceDir, "test.txt")
			putPermissionFile(t, source, "source")
			info := permissionApp(c).attachFile(source)
			if perm == "denied" {
				if !strings.Contains(info.Error, "source denied") || info.Token != "" {
					t.Fatalf("denied source imported: %+v", info)
				}
				assertNoStagedAttachments(t, c.WorkspaceDir)
			} else if info.Error != "" || info.Token == "" || info.OriginalPath != source {
				t.Fatalf("readable source rejected: %+v", info)
			}
		})
	}
}

func TestAttachmentSourceSymlinkDeniedProject(t *testing.T) {
	c := permissionConfig(t, "read-write")
	denied := t.TempDir()
	c.Projects = append(c.Projects, nullbot.Project{ID: "denied", Path: denied, Permission: "denied"})
	putPermissionFile(t, filepath.Join(denied, "secret.txt"), "secret")
	alias := filepath.Join(t.TempDir(), "alias")
	if err := permissionDirLink(denied, alias); err != nil {
		t.Skipf("link unavailable: %v", err)
	}
	if info := permissionApp(c).attachFile(filepath.Join(alias, "secret.txt")); info.Error == "" || info.Token != "" {
		t.Fatalf("denied source alias accepted: %+v", info)
	}
	assertNoStagedAttachments(t, c.WorkspaceDir)
}

func TestAttachmentCopyLimitsAndRegularFiles(t *testing.T) {
	c := permissionConfig(t, "read-write")
	a := permissionApp(c)
	if info := a.attachFile(t.TempDir()); !strings.Contains(info.Error, "regular files") {
		t.Fatalf("directory result: %+v", info)
	}
	source := filepath.Join(t.TempDir(), "large.bin")
	f, err := os.Create(source)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(maxAttachmentBytes + 1); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	if info := a.attachFile(source); !strings.Contains(info.Error, "20 MiB") || info.Token != "" {
		t.Fatalf("oversize result: %+v", info)
	}
	assertNoStagedAttachments(t, c.WorkspaceDir)
	if err := checkAttachmentFile(fakeAttachmentInfo{}); err == nil {
		t.Fatal("nonregular file accepted")
	}
}

type fakeAttachmentInfo struct{ os.FileInfo }

func (fakeAttachmentInfo) Mode() os.FileMode { return os.ModeNamedPipe }

type failingAttachmentReader struct{}

func (failingAttachmentReader) Read(p []byte) (int, error) {
	return copy(p, "partial"), errors.New("source failed")
}

func TestBoundedAttachmentCopyCleanup(t *testing.T) {
	for _, reader := range []io.Reader{failingAttachmentReader{}, io.LimitReader(zeroAttachmentReader{}, maxAttachmentBytes+1)} {
		c := permissionConfig(t, "read-write")
		if _, err := permissionApp(c).stageAttachment("partial.bin", reader); err == nil {
			t.Fatal("bad stream accepted")
		}
		assertNoStagedAttachments(t, c.WorkspaceDir)
	}
	dir := t.TempDir()
	source, dest := filepath.Join(dir, "src.txt"), filepath.Join(dir, "dest.txt")
	putPermissionFile(t, source, "new")
	putPermissionFile(t, dest, "existing")
	if err := copyFile(source, dest); err == nil {
		t.Fatal("existing destination overwritten")
	}
	data, _ := os.ReadFile(dest)
	if string(data) != "existing" {
		t.Fatal("existing destination modified")
	}
}

type zeroAttachmentReader struct{}

func (zeroAttachmentReader) Read(p []byte) (int, error) { clear(p); return len(p), nil }

func TestAttachmentQuotedPathParsing(t *testing.T) {
	dir := t.TempDir()
	first, second := filepath.Join(dir, "first file.txt"), filepath.Join(dir, "second file.txt")
	plain := filepath.Join(dir, "plain.txt")
	for _, path := range []string{first, second, plain} {
		putPermissionFile(t, path, "file")
	}
	for _, tc := range []struct {
		text string
		want []string
	}{
		{first, []string{first}},
		{`"` + first + `"`, []string{first}},
		{`"` + first + `" "` + second + `"`, []string{first, second}},
		{"'" + first + "'\t'" + second + "'", []string{first, second}},
		{first + "\r\n" + second, []string{first, second}},
		{`"` + first + `" ` + plain, []string{first, plain}},
		{plain + " " + plain, []string{plain, plain}},
		{"please read " + plain, nil},
		{`"` + first + `" trailing prose`, nil},
		{`"` + first, nil},
		{`"` + first + `""` + second + `"`, nil},
		{plain + ".", nil},
		{attachmentToken(first), nil},
		{dir, nil},
	} {
		t.Run(tc.text, func(t *testing.T) {
			if got := attachmentPathsFromText(tc.text); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}
