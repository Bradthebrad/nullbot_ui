package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
)

// MCPServers lists configured MCP servers with their live state.
func (a *App) MCPServers() []nullbot.MCPServerStatus {
	if a.bot == nil {
		return nil
	}
	return a.bot.MCPStatus(false)
}

// MCPServer returns one server's detailed status: tools, requirements and
// stderr tail.
func (a *App) MCPServer(id string) (nullbot.MCPServerStatus, error) {
	status, ok := a.bot.MCPServerStatusByID(strings.TrimSpace(id))
	if !ok {
		return nullbot.MCPServerStatus{}, fmt.Errorf("MCP server %q is not configured", id)
	}
	return status, nil
}

// StartMCPServer starts an enabled server now and returns its details.
func (a *App) StartMCPServer(id string) (nullbot.MCPServerStatus, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	err := a.bot.StartMCPServer(ctx, id)
	status, _ := a.bot.MCPServerStatusByID(strings.TrimSpace(id))
	return status, err
}

// RestartMCPServer restarts an enabled server and returns its details.
func (a *App) RestartMCPServer(id string) (nullbot.MCPServerStatus, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	err := a.bot.RestartMCPServer(ctx, id)
	status, _ := a.bot.MCPServerStatusByID(strings.TrimSpace(id))
	return status, err
}

// StopMCPServer stops a running server without disabling it.
func (a *App) StopMCPServer(id string) []nullbot.MCPServerStatus {
	a.bot.StopMCPServer(id)
	return a.bot.MCPStatus(false)
}

// SetMCPToolPolicy sets which capability a tool is treated as needing:
// auto, read, write, delete, execute or blocked.
func (a *App) SetMCPToolPolicy(server, tool, policy string) (nullbot.MCPServerStatus, error) {
	if err := a.bot.SetMCPToolPolicy(server, tool, policy); err != nil {
		return nullbot.MCPServerStatus{}, err
	}
	status, _ := a.bot.MCPServerStatusByID(strings.TrimSpace(server))
	return status, nil
}

// SetPrimaryProject makes an existing project the bot's default directory.
func (a *App) SetPrimaryProject(id string) (ProjectsState, error) {
	id = strings.TrimSpace(id)
	config := a.bot.Config()
	found := false
	for _, p := range config.Projects {
		if p.ID == id {
			found = true
		}
	}
	if !found {
		return a.Projects(), fmt.Errorf("project %q not found", id)
	}
	return a.SaveProjects(config.Projects, id)
}

// ModelCatalog returns provider models, cached for ten minutes. refresh
// forces a fetch.
func (a *App) ModelCatalog(refresh bool) []nullbot.ModelGroup {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return nullbot.CachedModelGroups(ctx, a.bot.Config(), refresh)
}

// UsageSummary returns usage totals and recent records without the full log.
func (a *App) UsageSummary() nullbot.UsageSnapshot {
	return a.bot.UsageSummary()
}
