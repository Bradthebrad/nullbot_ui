package main

import (
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// OpenExternal opens a web or email link in the user's default browser or
// mail client. Links never navigate the app window.
func (a *App) OpenExternal(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return fmt.Errorf("invalid link: %w", err)
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
		if u.Host == "" {
			return fmt.Errorf("invalid link: missing host")
		}
	case "mailto":
	default:
		return fmt.Errorf("only web and email links open externally (got %q)", u.Scheme)
	}
	if a.ctx == nil {
		return fmt.Errorf("app is not ready")
	}
	wailsRuntime.BrowserOpenURL(a.ctx, u.String())
	return nil
}

// Executable and script types are revealed in the file manager instead of
// opened, so a link in a chat reply can never run a program.
var revealOnlyExtensions = map[string]bool{
	".exe": true, ".bat": true, ".cmd": true, ".com": true, ".ps1": true, ".psm1": true, ".vbs": true, ".vbe": true,
	".js": true, ".jse": true, ".wsf": true, ".wsh": true, ".msi": true, ".msp": true, ".scr": true, ".lnk": true,
	".jar": true, ".hta": true, ".reg": true, ".cpl": true, ".msc": true, ".pif": true, ".application": true,
	".appref-ms": true, ".sh": true, ".command": true, ".app": true, ".url": true, ".inf": true, ".dll": true,
	".py": true, ".pyw": true, ".pyz": true, ".pyc": true, ".rdp": true, ".scf": true, ".library-ms": true, ".search-ms": true,
	".searchconnector-ms": true, ".settingcontent-ms": true, ".xll": true, ".terminal": true, ".fileloc": true, ".website": true,
	".gadget": true, ".ws": true, ".wsc": true, ".sct": true, ".shb": true, ".shs": true, ".mst": true, ".msix": true, ".msixbundle": true,
	".appx": true, ".appxbundle": true, ".appinstaller": true, ".xbap": true, ".chm": true, ".iqy": true, ".slk": true, ".jnlp": true,
	".action": true, ".workflow": true, ".tool": true, ".pkg": true, ".mpkg": true, ".dmg": true, ".ps1xml": true, ".psc1": true,
	".psd1": true, ".vb": true, ".vbscript": true, ".mde": true, ".ade": true, ".adp": true, ".accde": true, ".diagcab": true,
	".application-ms": true, ".hlp": true, ".ins": true, ".isp": true, ".job": true, ".mau": true, ".prg": true, ".scpt": true,
	".scptd": true, ".applescript": true, ".deb": true, ".rpm": true, ".run": true, ".desktop": true, ".appimage": true,
}

// OpenPath opens a file inside a configured project with its default app.
// Programs and scripts are revealed in the file manager instead.
func (a *App) OpenPath(path string) error {
	resolved, err := checkUIProjectPath(a.bot.Config(), strings.TrimSpace(path), false, false)
	if err != nil {
		return err
	}
	if _, err := os.Stat(resolved); err != nil {
		return err
	}
	// Folders count too: a macOS .app is a folder that launches.
	if revealOnlyExtensions[strings.ToLower(filepath.Ext(resolved))] {
		return revealInFileManager(resolved)
	}
	return openWithSystem(resolved)
}

// RevealPath shows a project file or folder in the system file manager.
func (a *App) RevealPath(path string) error {
	resolved, err := checkUIProjectPath(a.bot.Config(), strings.TrimSpace(path), false, false)
	if err != nil {
		return err
	}
	return revealInFileManager(resolved)
}

func openWithSystem(path string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", path).Start()
	case "darwin":
		return exec.Command("open", path).Start()
	default:
		return exec.Command("xdg-open", path).Start()
	}
}

func revealInFileManager(path string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("explorer.exe", "/select,", path).Start()
	case "darwin":
		return exec.Command("open", "-R", path).Start()
	default:
		dir := path
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			dir = filepath.Dir(path)
		}
		return exec.Command("xdg-open", dir).Start()
	}
}
