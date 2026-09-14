package main

import nullbot "github.com/Bradthebrad/nullbot/pkg/app"

// SubmitWithSkills validates selection before accepting the composer draft and
// shares the same admission gate as the main composer.
func (a *App) SubmitWithSkills(input string, skillPaths []string) (nullbot.Reply, error) {
	return a.SubmitChatRequest(ChatRequest{Mode: "normal", Text: input, SkillPaths: skillPaths})
}
