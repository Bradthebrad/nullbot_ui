package main

import (
	"context"
	"strings"
	"sync"
	"time"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
	"github.com/Bradthebrad/nullbot/pkg/infra"
)

// Cloud infrastructure: plans waiting for approval, what NullBot made on AWS
// and Google Cloud, what runs on each machine, and SSH tunnels. Bound only
// to the local Wails UI; this is where a person approves a plan, which no
// agent can do. Running a plan happens in the background: each step
// arrives as a "changed" event with topic "infra", and the end as an
// "infra-run" event.

// desktopDecider is who approved or ran a plan from here, in the ledger.
const desktopDecider = "you (desktop app)"

// InfraRunEvent is the end of a plan run started here.
type InfraRunEvent struct {
	Plan  string `json:"plan"`
	Title string `json:"title"`
	State string `json:"state"`
	Error string `json:"error,omitempty"`
}

var infraRuns = struct {
	sync.Mutex
	cancel map[string]context.CancelFunc
}{cancel: map[string]context.CancelFunc{}}

func (a *App) InfraState() (nullbot.InfraState, error) {
	if err := a.ready(); err != nil {
		return nullbot.InfraState{}, err
	}
	return a.bot.InfraState()
}

// DecideInfraPlan approves or rejects a plan. Approving with run set also
// starts it, unless an agent waiting on it got there first.
func (a *App) DecideInfraPlan(id string, approve, run bool) (infra.Plan, error) {
	if err := a.ready(); err != nil {
		return infra.Plan{}, err
	}
	plan, err := a.bot.DecideInfraPlan(id, approve, desktopDecider)
	if err != nil || !approve || !run {
		return plan, err
	}
	return plan, a.RunInfraPlan(id)
}

// RunInfraPlan starts an approved plan and returns at once.
func (a *App) RunInfraPlan(id string) error {
	if err := a.ready(); err != nil {
		return err
	}
	infraRuns.Lock()
	if _, running := infraRuns.cancel[id]; running {
		infraRuns.Unlock()
		return nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	infraRuns.cancel[id] = cancel
	infraRuns.Unlock()
	go func() {
		defer func() {
			infraRuns.Lock()
			delete(infraRuns.cancel, id)
			infraRuns.Unlock()
			cancel()
		}()
		plan, err := a.bot.ApplyInfraPlan(ctx, id, desktopDecider)
		event := InfraRunEvent{Plan: id, Title: plan.Title, State: plan.State}
		if err != nil {
			// An agent waiting on the plan may have started it a moment
			// earlier; its run is the one that counts.
			if plan.State == infra.PlanApplying || plan.State == infra.PlanApplied {
				return
			}
			event.Error = err.Error()
		}
		a.emit("infra-run", event)
	}()
	return nil
}

// StopInfraPlan stops a run started here before its next step. A step
// already running finishes; what it made stays in the inventory.
func (a *App) StopInfraPlan(id string) bool {
	infraRuns.Lock()
	defer infraRuns.Unlock()
	cancel, ok := infraRuns.cancel[id]
	if ok {
		cancel()
	}
	return ok
}

// PlanInfraDestroy proposes removing resources, by NullBot id, name or plan.
func (a *App) PlanInfraDestroy(ids []string, deleteContents bool, reason string) (infra.Plan, error) {
	if err := a.ready(); err != nil {
		return infra.Plan{}, err
	}
	return a.bot.PlanInfraDestroy(ids, deleteContents, desktopDecider, strings.TrimSpace(reason))
}

func (a *App) InfraLedger(plan string, limit int) ([]infra.LedgerEntry, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	return a.bot.InfraLedger(plan, limit)
}

// SetInfraAgentTools lets agents propose plans, and run the ones you
// approve.
func (a *App) SetInfraAgentTools(on bool) error {
	if err := a.ready(); err != nil {
		return err
	}
	return a.bot.UpdateConfig(func(c *nullbot.Config) { c.Infra.AgentTools = on })
}

// InspectNode logs in to a machine NullBot made and reads what it runs.
func (a *App) InspectNode(id string) (nullbot.NodeReport, error) {
	if err := a.ready(); err != nil {
		return nullbot.NodeReport{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	return a.bot.InspectNode(ctx, id)
}

// ThisComputer reads what listens on this computer.
func (a *App) ThisComputer() nullbot.NodeReport {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return nullbot.ThisComputer(ctx)
}

func (a *App) OpenTunnel(id string, remotePort, localPort int) (nullbot.Tunnel, error) {
	if err := a.ready(); err != nil {
		return nullbot.Tunnel{}, err
	}
	t, err := a.bot.OpenTunnel(id, remotePort, localPort)
	if err == nil {
		a.emit("changed", map[string]string{"topic": nullbot.ChangeInfra})
	}
	return t, err
}

func (a *App) Tunnels() []nullbot.Tunnel {
	return nullbot.Tunnels()
}

func (a *App) CloseTunnel(id string) {
	nullbot.CloseTunnel(id)
	a.emit("changed", map[string]string{"topic": nullbot.ChangeInfra})
}

// ConnectNodeOllama tunnels to a machine's Ollama and adds it as a model
// server.
func (a *App) ConnectNodeOllama(id string) (nullbot.LocalEndpoint, error) {
	if err := a.ready(); err != nil {
		return nullbot.LocalEndpoint{}, err
	}
	e, err := a.bot.ConnectNodeOllama(id)
	if err != nil {
		return e, err
	}
	a.emit("changed", map[string]string{"topic": nullbot.ChangeInfra})
	return e, nil
}

// stopInfra ends runs started here and closes tunnels, when the app quits.
func stopInfra() {
	infraRuns.Lock()
	for _, cancel := range infraRuns.cancel {
		cancel()
	}
	infraRuns.Unlock()
	nullbot.CloseTunnels()
}
