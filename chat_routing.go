package main

import (
	"context"
	"fmt"
	"strings"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
)

// ChatRequest is the captured composer draft. Attachment tokens remain in Text;
// selected skill contents never enter the visible user message.
type ChatRequest struct {
	Mode        string   `json:"mode"`
	Text        string   `json:"text"`
	SkillPaths  []string `json:"skill_paths,omitempty"`
	RequestID   string   `json:"request_id,omitempty"`
	TargetJobID string   `json:"target_job_id,omitempty"`
}

func (a *App) SubmitChatRequest(request ChatRequest) (nullbot.Reply, error) {
	if a.initErr != nil {
		return nullbot.Reply{}, a.initErr
	}
	if a.bot == nil {
		return nullbot.Reply{}, fmt.Errorf("chat service is not initialized")
	}
	request.Text = strings.TrimSpace(request.Text)
	if request.Text == "" {
		return nullbot.Reply{}, fmt.Errorf("input is required")
	}
	mode := request.Mode
	if mode == "" || mode == "normal" {
		mode = "send"
	}
	if mode != "send" && mode != "also" && mode != "queue" && mode != "steer" {
		return nullbot.Reply{}, fmt.Errorf("unknown submission mode %q", request.Mode)
	}
	ctx, err := nullbot.WithSelectedSkills(context.Background(), a.bot.Config(), request.SkillPaths)
	if err != nil {
		return nullbot.Reply{}, err
	}
	if mode == "send" && strings.HasPrefix(request.Text, "/") {
		return a.submit(request.Text)
	}
	receipt := a.bot.SubmitRoutedRequest(ctx, request.Text, mode, request.RequestID, request.TargetJobID)
	reply := a.bot.State()
	reply.Activity = nil
	reply.Command = request.Text
	if reply.Data == nil {
		reply.Data = map[string]any{}
	}
	reply.Data["submission"] = receipt
	reply.Data["request_id"] = firstNonEmpty(receipt.RequestID, receipt.ID)
	reply.Data["selected_skills"] = request.SkillPaths
	switch receipt.Status {
	case "running":
		reply.Message = "Chat request started."
		reply.Data["submission_status"] = "started"
	case "queued":
		reply.Message = "Message queued after current tasks."
		reply.Data["submission_status"] = "queued"
	case "accepted":
		reply.Message = "Steering instruction pending the next safe handoff."
		reply.Data["submission_status"] = "steering_pending"
	default:
		reply.Message = receipt.Error
		reply.Data["submission_status"] = "rejected"
	}
	reply.Data["background"] = receipt.Status != "rejected"
	reply.Data["accepted"] = receipt.Status != "rejected"
	reply.Data["mode"] = request.Mode
	reply.Data["job_id"] = receipt.ID
	return reply, nil
}

func (a *App) RemoveQueuedChat(requestID string) (nullbot.SubmissionSnapshot, error) {
	if a.bot == nil {
		return nullbot.SubmissionSnapshot{}, fmt.Errorf("chat service is not initialized")
	}
	if !a.bot.CancelQueuedSubmission(requestID) {
		return a.bot.SubmissionState(), fmt.Errorf("submission is no longer queued")
	}
	return a.bot.SubmissionState(), nil
}

func (a *App) ChatSubmissionState() nullbot.SubmissionSnapshot {
	if a.bot == nil {
		return nullbot.SubmissionSnapshot{}
	}
	return a.bot.SubmissionState()
}

// publishSubmissionCompletion publishes current primary history, not the older
// history snapshot captured by an independently finishing Also job.
func (a *App) publishSubmissionCompletion(record nullbot.ActivityRecord) {
	if record.Kind != "submission" || !(record.Status == "submission done" || record.Status == "submission error" || record.Status == "submission canceled") {
		return
	}
	snapshot := a.bot.SubmissionState()
	for _, job := range snapshot.Jobs {
		if job.ID != record.SubmissionID || job.Reply == nil {
			continue
		}
		reply := a.bot.State()
		reply.Message = job.Reply.Message
		reply.Command = job.Reply.Command
		reply.OpenPanel = job.Reply.OpenPanel
		data := make(map[string]any)
		for key, value := range job.Reply.Data {
			if key != "submissions" {
				data[key] = value
			}
		}
		data["submissions"] = snapshot
		data["submission_id"] = job.ID
		data["submission_mode"] = job.Mode
		data["mode"] = job.Mode
		data["request_id"] = firstNonEmpty(job.RequestID, job.ID)
		data["submission_status"] = job.Status
		reply.Data = data
		reply.Activity = nil
		a.emit("reply", reply)
		return
	}
}
