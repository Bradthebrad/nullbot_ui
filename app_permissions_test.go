package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
)

func permissionConfig(t *testing.T, permission string) nullbot.Config {
	t.Helper()
	c := nullbot.DefaultConfig()
	c.AppDir = t.TempDir()
	c.WorkspaceDir = t.TempDir()
	c.Projects = []nullbot.Project{{ID: "workspace", Name: "Workspace", Path: c.WorkspaceDir, Permission: permission}}
	c.PrimaryProjectID = "workspace"
	c.SkillDirs = []string{filepath.Join(c.AppDir, "skills")}
	return c
}
func permissionApp(c nullbot.Config) *App { return &App{bot: nullbot.New(c)} }
func putPermissionFile(t *testing.T, path, text string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
}
func TestDiscoverMCPToolsPermissionGate(t *testing.T) {
	for _, tc := range []struct {
		name, permission        string
		enabled, legacy, nested bool
		want                    string
	}{
		{name: "disabled full", permission: "full", want: "disabled"},
		{name: "read only", permission: "read-only", enabled: true, want: "Full"},
		{name: "read write", permission: "read-write", enabled: true, want: "Full"},
		{name: "legacy", permission: "full", enabled: true, legacy: true, want: "Full"},
		{name: "other restricted project", permission: "full", enabled: true, nested: true, want: "Full"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := permissionConfig(t, tc.permission)
			if tc.legacy {
				c.Projects = nil
			}
			if tc.nested {
				c.Projects = append(c.Projects, nullbot.Project{ID: "restricted", Path: t.TempDir(), Permission: "read-only"})
			}
			// Any attempt to construct a client instead of rejecting will fail with a
			// different error (the command deliberately does not exist).
			c.EnabledMCPServers = map[string]nullbot.MCPEntry{"test": {Enabled: tc.enabled, Transport: "stdio", Command: "nullbot-permission-test-nonexistent-command"}}
			_, err := permissionApp(c).DiscoverMCPTools("test")
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q gate, got %v", tc.want, err)
			}
		})
	}
}
func TestRelativeFileMutationsUseAuthorizedWorkspace(t *testing.T) {
	c := permissionConfig(t, "read-write")
	cwd := t.TempDir()
	t.Chdir(cwd)
	a := permissionApp(c)
	for _, name := range []string{"save.txt", "delete.txt"} {
		putPermissionFile(t, filepath.Join(cwd, name), "outside")
		putPermissionFile(t, filepath.Join(c.WorkspaceDir, name), "inside")
	}
	if _, err := a.SaveFile(SaveFileRequest{Path: "save.txt", Content: "updated"}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.DeletePath("delete.txt"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(c.WorkspaceDir, "save.txt"))
	if err != nil || string(data) != "updated" {
		t.Fatalf("workspace save: %q %v", data, err)
	}
	if _, err := os.Stat(filepath.Join(c.WorkspaceDir, "delete.txt")); !os.IsNotExist(err) {
		t.Fatalf("workspace file not deleted: %v", err)
	}
	for _, name := range []string{"save.txt", "delete.txt"} {
		data, err := os.ReadFile(filepath.Join(cwd, name))
		if err != nil || string(data) != "outside" {
			t.Fatalf("CWD file mutated: %s %q %v", name, data, err)
		}
	}
}
func TestAttachmentWritePermissions(t *testing.T) {
	for _, perm := range []string{"read-only", "read-write"} {
		t.Run(perm, func(t *testing.T) {
			c := permissionConfig(t, perm)
			source := filepath.Join(t.TempDir(), "source.txt")
			putPermissionFile(t, source, "attachment")
			path, err := permissionApp(c).copyAttachmentIntoWorkspace(source)
			if perm == "read-only" {
				if err == nil {
					t.Fatal("read-only attachment allowed")
				}
				if _, err := os.Stat(filepath.Join(c.WorkspaceDir, ".nullbot")); !os.IsNotExist(err) {
					t.Fatalf("destination created before authorization: %v", err)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				data, err := os.ReadFile(path)
				if err != nil || string(data) != "attachment" {
					t.Fatalf("bad copy: %q %v", data, err)
				}
			}
		})
	}
}

// Directory junctions exercise the same canonical-path policy on Windows
// without requiring the symbolic-link privilege.
func permissionDirLink(target, link string) error {
	if err := os.Symlink(target, link); err == nil {
		return nil
	} else if runtime.GOOS != "windows" {
		return err
	}
	return exec.Command("cmd.exe", "/c", "mklink", "/J", link, target).Run()
}

func TestAttachmentSymlinkEscape(t *testing.T) {
	c := permissionConfig(t, "read-write")
	outside := t.TempDir()
	if err := permissionDirLink(outside, filepath.Join(c.WorkspaceDir, ".nullbot")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	source := filepath.Join(t.TempDir(), "source.txt")
	putPermissionFile(t, source, "attachment")
	if _, err := permissionApp(c).copyAttachmentIntoWorkspace(source); err == nil {
		t.Fatal("escaping attachment allowed")
	}
	entries, err := os.ReadDir(outside)
	if err != nil || len(entries) != 0 {
		t.Fatalf("escape wrote files: %v %v", entries, err)
	}
}
func TestSaveSkillProjectPermissions(t *testing.T) {
	for _, tc := range []struct {
		name, perm        string
		inProject, legacy bool
		allowed           bool
	}{
		{name: "read only", perm: "read-only", inProject: true},
		{name: "read write", perm: "read-write", inProject: true, allowed: true},
		{name: "app owned", perm: "read-only", allowed: true},
		{name: "legacy read only", perm: "read-only", inProject: true, legacy: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := permissionConfig(t, tc.perm)
			if tc.inProject {
				c.SkillDirs = []string{filepath.Join(c.WorkspaceDir, "skills")}
			}
			if tc.legacy {
				c.Projects = nil
			}
			_, err := permissionApp(c).SaveSkill(SkillSaveRequest{Name: "test", Content: "# Test"})
			if tc.allowed {
				if err != nil {
					t.Fatal(err)
				}
			} else {
				if err == nil {
					t.Fatal("read-only skill write allowed")
				}
				if _, err := os.Stat(c.SkillDirs[0]); !os.IsNotExist(err) {
					t.Fatalf("directory created before authorization: %v", err)
				}
			}
		})
	}
}
func TestSaveSkillSymlinkPolicy(t *testing.T) {
	for _, escape := range []bool{false, true} {
		t.Run(map[bool]string{false: "root aliases read-only project", true: "skill escapes configured root"}[escape], func(t *testing.T) {
			c := permissionConfig(t, "read-only")
			root := c.SkillDirs[0]
			if escape {
				if err := os.MkdirAll(root, 0700); err != nil {
					t.Fatal(err)
				}
				if err := permissionDirLink(t.TempDir(), filepath.Join(root, "test")); err != nil {
					t.Skipf("symlink unavailable: %v", err)
				}
			} else if err := permissionDirLink(c.WorkspaceDir, root); err != nil {
				t.Skipf("symlink unavailable: %v", err)
			}
			if _, err := permissionApp(c).SaveSkill(SkillSaveRequest{Name: "test", Content: "# Test"}); err == nil {
				t.Fatal("symlink policy bypass")
			}
		})
	}
}
