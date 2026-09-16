package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestAttachmentTokenUsesPortableSeparators(t *testing.T) {
	path := filepath.Join(t.TempDir(), "screen (1).png")
	token := attachmentToken(path)
	if strings.Contains(token, `\`) {
		t.Fatalf("token must not require backslash unescaping: %s", token)
	}
	if token != `@file("`+filepath.ToSlash(path)+`")` {
		t.Fatalf("unexpected token: %s", token)
	}
}
