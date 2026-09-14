package main

import (
	"fmt"
	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
)

type ProjectsState struct {
	Projects         []nullbot.Project `json:"projects"`
	PrimaryProjectID string            `json:"primary_project_id"`
	WorkspaceDir     string            `json:"workspace_dir"`
	Warning          string            `json:"warning"`
}

func (a *App) Projects() ProjectsState {
	c := a.bot.Config()
	return ProjectsState{c.Projects, c.PrimaryProjectID, c.WorkspaceDir, nullbot.FullAccessWarning}
}
func (a *App) SaveProjects(projects []nullbot.Project, primaryProjectID string) (ProjectsState, error) {
	if len(projects) == 0 {
		return ProjectsState{}, fmt.Errorf("at least one project is required")
	}
	if err := a.bot.UpdateConfig(func(c *nullbot.Config) {
		c.Projects = projects
		c.PrimaryProjectID = primaryProjectID
		for _, p := range projects {
			if p.ID == primaryProjectID {
				c.WorkspaceDir = p.Path
			}
		}
	}); err != nil {
		return ProjectsState{}, err
	}
	a.bot.MarkRuntimeDirty("projects updated")
	return a.Projects(), nil
}
