package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
)

func TestLoadSessionSeparatesAlsoAndRejectsHeldQueue(t *testing.T) {
	a := permissionApp(permissionConfig(t, "read-write"))
	dir := filepath.Join(a.bot.Config().AppDir, "history")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	var content []byte
	for _, message := range []nullbot.Message{
		{Role: "assistant", Content: "primary final", Lane: "primary", SubmissionID: "old-primary"},
		{Role: "commentary", Content: "independent commentary", Lane: "also", VisibleOnly: true},
	} {
		line, err := json.Marshal(persistedMessage{Message: message})
		if err != nil {
			t.Fatal(err)
		}
		content = append(content, append(line, '\n')...)
	}
	if err := os.WriteFile(filepath.Join(dir, "routing-test.jsonl"), content, 0600); err != nil {
		t.Fatal(err)
	}
	reply, err := a.LoadSession("routing-test", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(reply.History) != 1 || reply.History[0].Content != "primary final" || reply.Data["history_replace"] != true {
		t.Fatalf("incorrect session replacement: %#v", reply)
	}
	a.bot.RequestPause()
	if _, err := a.SubmitChatRequest(ChatRequest{Mode: "queue", Text: "held"}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.LoadSession("routing-test", 0); err == nil {
		t.Fatal("session replaced while queue held")
	}
}

func TestChatRequestValidationDoesNotAcceptDraft(t *testing.T) {
	a := permissionApp(permissionConfig(t, "read-write"))
	for _, request := range []ChatRequest{
		{Text: "  "}, {Text: "hello", Mode: "unknown"},
		{Text: "hello", Mode: "queue", SkillPaths: []string{"missing/SKILL.md"}},
	} {
		if _, err := a.SubmitChatRequest(request); err == nil {
			t.Fatalf("expected validation error for %#v", request)
		}
	}
	if state := a.ChatSubmissionState(); len(state.Jobs) != 0 || len(state.Queue) != 0 {
		t.Fatalf("invalid draft was accepted: %#v", state)
	}
}

func TestChatQueuedRequestDeduplicatesAndCanBeRemoved(t *testing.T) {
	a := permissionApp(permissionConfig(t, "read-write"))
	a.bot.RequestPause()
	req := ChatRequest{Mode: "queue", Text: "keep this draft", RequestID: "draft-123"}
	first, err := a.SubmitChatRequest(req)
	if err != nil {
		t.Fatal(err)
	}
	second, err := a.SubmitChatRequest(req)
	if err != nil {
		t.Fatal(err)
	}
	if first.Data["request_id"] != req.RequestID || first.Data["job_id"] != second.Data["job_id"] {
		t.Fatal("request identity was not preserved")
	}
	if len(a.ChatSubmissionState().Queue) != 1 {
		t.Fatal("duplicate queue entry")
	}
	if _, err := a.RemoveQueuedChat(req.RequestID); err != nil {
		t.Fatal(err)
	}
	if len(a.ChatSubmissionState().Queue) != 0 {
		t.Fatal("queue removal failed")
	}
	if _, err := json.Marshal(a.bot.State()); err != nil {
		t.Fatal(err)
	}
}

func TestChatNormalSlashUsesCommandPath(t *testing.T) {
	a := permissionApp(permissionConfig(t, "read-write"))
	reply, err := a.SubmitChatRequest(ChatRequest{Mode: "normal", Text: "/help"})
	if err != nil {
		t.Fatal(err)
	}
	if reply.Command != "/help" {
		t.Fatalf("slash request not routed as command: %#v", reply)
	}
	if len(a.ChatSubmissionState().Jobs) != 0 {
		t.Fatal("command created model job")
	}
}

func TestChatSteerWithoutPrimaryPreservesDraft(t *testing.T) {
	a := permissionApp(permissionConfig(t, "read-write"))
	reply, err := a.SubmitChatRequest(ChatRequest{Mode: "steer", Text: "change direction", TargetJobID: "old-job"})
	if err != nil {
		t.Fatal(err)
	}
	if reply.Data["accepted"] != false || reply.Data["submission_status"] != "rejected" {
		t.Fatalf("unexpected acceptance: %#v", reply.Data)
	}
	if len(reply.History) != 0 {
		t.Fatal("rejected steering polluted history")
	}
	if _, err := json.Marshal(reply); err != nil {
		t.Fatal(err)
	}
}
