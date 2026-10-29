package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
)

// Chats: several conversations at once. Each binding here names its chat;
// the older bindings without one act on the main chat.

// chat returns a live chat's App; empty means the main chat.
func (a *App) chat(id string) (*nullbot.App, error) {
	if a.initErr != nil {
		return nil, a.initErr
	}
	if a.hub == nil {
		if a.bot == nil {
			return nil, errors.New("chat service is not initialized")
		}
		return a.bot, nil
	}
	bot, ok := a.hub.Chat(chatID(id))
	if !ok {
		return nil, fmt.Errorf("that chat is closed")
	}
	return bot, nil
}

func chatID(id string) string {
	if id = strings.TrimSpace(id); id == "" {
		return nullbot.MainChat
	}
	return id
}

// tagged marks a reply with its chat, so the UI routes it.
func tagged(reply nullbot.Reply, chat string) nullbot.Reply {
	if reply.Data == nil {
		reply.Data = map[string]any{}
	}
	reply.Data["chat"] = chatID(chat)
	return reply
}

func (a *App) emitReply(chat string, reply nullbot.Reply) {
	a.emit("reply", tagged(reply, chat))
}

// Chats lists the open chats with their state.
func (a *App) Chats() ([]nullbot.ChatInfo, error) {
	if a.hub == nil {
		return nil, errors.New("chat service is not initialized")
	}
	return a.hub.Chats(), nil
}

// OpenChat starts a new chat.
func (a *App) OpenChat(title string) (nullbot.ChatInfo, error) {
	if a.hub == nil || a.initErr != nil {
		return nullbot.ChatInfo{}, errors.New("chat service is not initialized")
	}
	return a.hub.Open(title)
}

// ContinueChat opens a saved conversation in its own chat, which keeps
// adding to the same history.
func (a *App) ContinueChat(historyID string) (nullbot.ChatInfo, error) {
	if a.hub == nil || a.initErr != nil {
		return nullbot.ChatInfo{}, errors.New("chat service is not initialized")
	}
	return a.hub.Continue(historyID, "")
}

// CloseChat stops a chat's work and closes it. Its history stays saved.
func (a *App) CloseChat(id string) error {
	if a.hub == nil {
		return errors.New("chat service is not initialized")
	}
	return a.hub.Close(id)
}

func (a *App) RenameChat(id, title string) error {
	if a.hub == nil {
		return errors.New("chat service is not initialized")
	}
	return a.hub.Rename(id, title)
}

// ChatState is one chat's conversation, activity and queue.
func (a *App) ChatState(chat string) (nullbot.Reply, error) {
	bot, err := a.chat(chat)
	if err != nil {
		return nullbot.Reply{}, err
	}
	return tagged(bot.State(), chat), nil
}

// ChatSubmissions is one chat's queue and run state.
func (a *App) ChatSubmissions(chat string) (nullbot.SubmissionSnapshot, error) {
	bot, err := a.chat(chat)
	if err != nil {
		return nullbot.SubmissionSnapshot{}, err
	}
	return bot.SubmissionState(), nil
}

// ChatControl pauses, resumes or stops a chat. target names the request
// to stop, as for StopRun.
func (a *App) ChatControl(chat, action, target string) (nullbot.Reply, error) {
	bot, err := a.chat(chat)
	if err != nil {
		return nullbot.Reply{}, err
	}
	message := ""
	switch action {
	case "pause":
		bot.PauseRuns()
		message = "Pausing. Steps already under way finish, then everything waits until you resume."
	case "resume":
		bot.ResumeRuns()
		message = "Resumed."
	case "stop":
		if err := bot.StopRequest(target); err != nil {
			return nullbot.Reply{}, err
		}
		message = "Stopping. The current step finishes, then the request wraps up."
	case "stop_everything":
		bot.StopEverything()
		message = "Stopped everything. Queued requests wait until you resume."
	default:
		return nullbot.Reply{}, fmt.Errorf("unknown action %q", action)
	}
	return a.runReplyIn(chat, message)
}

func (a *App) runReplyIn(chat, message string) (nullbot.Reply, error) {
	bot, err := a.chat(chat)
	if err != nil {
		return nullbot.Reply{}, err
	}
	reply := bot.State()
	reply.Message = message
	reply.Activity = nil
	reply = tagged(reply, chat)
	a.emit("reply", reply)
	return reply, nil
}

// ChatCommand runs a slash command in a chat.
func (a *App) ChatCommand(chat, input string) (nullbot.Reply, error) {
	if !strings.HasPrefix(strings.TrimSpace(input), "/") {
		input = "/" + strings.TrimLeft(input, "/")
	}
	return a.submitIn(chat, input)
}

func (a *App) submitIn(chat, input string) (nullbot.Reply, error) {
	bot, err := a.chat(chat)
	if err != nil {
		return nullbot.Reply{}, err
	}
	a.submitMu.Lock()
	defer a.submitMu.Unlock()
	reply := bot.Submit(context.Background(), input)
	reply.Activity = nil
	reply = tagged(reply, chat)
	a.emit("reply", reply)
	return reply, nil
}

// ChatSteerSubagent sends guidance to one of a chat's subagents.
func (a *App) ChatSteerSubagent(chat, taskID, text string) error {
	bot, err := a.chat(chat)
	if err != nil {
		return err
	}
	return bot.SteerTask(taskID, text)
}

// CancelChatTask cancels one of a chat's subagents or background tasks.
func (a *App) CancelChatTask(chat, id string) ([]nullbot.AgentTask, error) {
	bot, err := a.chat(chat)
	if err != nil {
		return nil, err
	}
	if !bot.CancelTask(id) {
		return a.allTasks(), fmt.Errorf("task not cancelable or not found")
	}
	return a.allTasks(), nil
}

func (a *App) allTasks() []nullbot.AgentTask {
	if a.hub != nil {
		return a.hub.Tasks()
	}
	return a.bot.TaskSnapshots()
}

// ChatCompact summarizes a chat's conversation.
func (a *App) ChatCompact(chat, focus string) (nullbot.Reply, error) {
	bot, err := a.chat(chat)
	if err != nil {
		return nullbot.Reply{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	result, err := bot.CompactConversation(ctx, strings.TrimSpace(focus))
	if err != nil {
		return nullbot.Reply{}, err
	}
	updated := tagged(bot.State(), chat)
	updated.Data["compaction"] = result.Report
	updated.Message = fmt.Sprintf("Compacted %d messages, from about %d to %d tokens.", result.Report.Summarized, result.Report.BeforeTokens, result.Report.AfterTokens)
	updated.OpenPanel = "chat"
	a.emit("reply", updated)
	return updated, nil
}

// ChatAnalyze runs /analyze in a chat, in the background.
func (a *App) ChatAnalyze(chat, focus string) (nullbot.Reply, error) {
	cmd := "/analyze"
	if strings.TrimSpace(focus) != "" {
		cmd += " " + strings.TrimSpace(focus)
	}
	return a.startBackgroundSubmitIn(chat, cmd, "Workspace analysis")
}

func (a *App) startBackgroundSubmitIn(chat, input, label string) (nullbot.Reply, error) {
	if !strings.HasPrefix(strings.TrimSpace(input), "/") {
		return a.SubmitChatRequest(ChatRequest{Chat: chat, Mode: "normal", Text: input})
	}
	bot, err := a.chat(chat)
	if err != nil {
		return nullbot.Reply{}, err
	}
	input = strings.TrimSpace(input)
	reply := tagged(bot.State(), chat)
	reply.Message = firstNonEmpty(label, "Background request") + " started."
	reply.Command = input
	reply.Data["background"] = true
	reply.Data["input"] = input
	go func() {
		done := bot.Submit(context.Background(), input)
		done.Activity = nil
		a.emitReply(chat, done)
	}()
	return reply, nil
}

// RemoveChatQueued takes a queued request out of a chat's queue.
func (a *App) RemoveChatQueued(chat, requestID string) (nullbot.SubmissionSnapshot, error) {
	bot, err := a.chat(chat)
	if err != nil {
		return nullbot.SubmissionSnapshot{}, err
	}
	if !bot.CancelQueuedSubmission(requestID) {
		return bot.SubmissionState(), fmt.Errorf("submission is no longer queued")
	}
	return bot.SubmissionState(), nil
}
