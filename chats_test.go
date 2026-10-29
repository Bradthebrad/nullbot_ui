package main

import (
	"strings"
	"testing"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
)

func chatsTestApp(t *testing.T) *App {
	t.Helper()
	cfg := nullbot.DefaultConfig()
	cfg.AppDir = t.TempDir()
	cfg.WorkspaceDir = t.TempDir()
	cfg.EnabledMCPServers = nil
	bot := nullbot.New(cfg)
	a := &App{bot: bot, hub: nullbot.HubFor(bot), localFiles: newLocalFiles()}
	t.Cleanup(a.hub.Shutdown)
	return a
}

func TestChatBindingsRouteToTheirChat(t *testing.T) {
	a := chatsTestApp(t)
	info, err := a.OpenChat("Notes")
	if err != nil {
		t.Fatal(err)
	}
	chats, _ := a.Chats()
	if len(chats) != 2 || chats[0].ID != nullbot.MainChat || chats[1].ID != info.ID || chats[1].Title != "Notes" {
		t.Fatalf("chats %+v", chats)
	}
	reply, err := a.ChatCommand(info.ID, "/clear")
	if err != nil || reply.Data["chat"] != info.ID {
		t.Fatalf("command reply %+v %v", reply.Data, err)
	}
	if _, err := a.ChatControl(info.ID, "pause", ""); err != nil {
		t.Fatal(err)
	}
	if state, _ := a.ChatSubmissions(info.ID); !state.Paused {
		t.Fatalf("the chat did not pause: %+v", state)
	}
	if state, _ := a.ChatSubmissions(nullbot.MainChat); state.Paused {
		t.Fatal("pausing a chat paused the main chat")
	}
	// A request to a paused chat is refused there, not sent to main.
	reply, err = a.SubmitChatRequest(ChatRequest{Chat: info.ID, Mode: "send", Text: "hello"})
	if err != nil || reply.Data["chat"] != info.ID || reply.Data["submission_status"] != "rejected" {
		t.Fatalf("send to a paused chat: %+v %v", reply.Data, err)
	}
	if err := a.RenameChat(info.ID, "Release notes"); err != nil {
		t.Fatal(err)
	}
	if err := a.CloseChat(nullbot.MainChat); err == nil {
		t.Fatal("closed the main chat")
	}
	if err := a.CloseChat(info.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.ChatState(info.ID); err == nil || !strings.Contains(err.Error(), "closed") {
		t.Fatalf("state of a closed chat: %v", err)
	}
}

func TestChangeKeysKeepChatsApart(t *testing.T) {
	for _, tc := range []struct{ chat, topic, chatOut, topicOut string }{
		{"chat-2", nullbot.ChangeSubmissions, "chat-2", nullbot.ChangeSubmissions},
		{"", nullbot.ChangeHistory, nullbot.MainChat, nullbot.ChangeHistory},
		{"chat-2", nullbot.ChangeMCP, "", nullbot.ChangeMCP},
	} {
		chat, topic := splitChangeKey(changeKey(tc.chat, tc.topic))
		if chat != tc.chatOut || topic != tc.topicOut {
			t.Errorf("%s/%s -> %q %q", tc.chat, tc.topic, chat, topic)
		}
	}
}
