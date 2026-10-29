package main

import (
	"context"
	"fmt"
	"sync"
	"time"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
	"github.com/Bradthebrad/nullbot/pkg/localmodels"
)

// Local model servers: Ollama, llama.cpp, LM Studio, vLLM and other
// OpenAI-compatible servers. Pulls run in the background and report
// progress as "model-pull" events.

// ModelPullEvent is one step of a pull, or its end.
type ModelPullEvent struct {
	Server    string `json:"server"`
	Model     string `json:"model"`
	Status    string `json:"status"`
	Completed int64  `json:"completed,omitempty"`
	Total     int64  `json:"total,omitempty"`
	Done      bool   `json:"done,omitempty"`
	Error     string `json:"error,omitempty"`
}

var pulls = struct {
	sync.Mutex
	cancel map[string]context.CancelFunc
}{cancel: map[string]context.CancelFunc{}}

func (a *App) LocalEndpoints(check bool) ([]nullbot.LocalEndpointInfo, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return a.bot.LocalEndpoints(ctx, check), nil
}

func (a *App) SaveLocalEndpoint(endpoint nullbot.LocalEndpoint, previousID string) (nullbot.LocalEndpoint, error) {
	if err := a.ready(); err != nil {
		return endpoint, err
	}
	return a.bot.SaveLocalEndpoint(endpoint, previousID)
}

func (a *App) RemoveLocalEndpoint(id string) error {
	if err := a.ready(); err != nil {
		return err
	}
	return a.bot.RemoveLocalEndpoint(id)
}

func (a *App) FindLocalServers() ([]nullbot.LocalServerFound, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return a.bot.FindLocalServers(ctx), nil
}

// LocalServerKinds lists the kinds of server, with their usual addresses.
func (a *App) LocalServerKinds() []map[string]string {
	out := make([]map[string]string, 0, len(localmodels.Kinds))
	for _, k := range localmodels.Kinds {
		out = append(out, map[string]string{"id": string(k), "label": k.Label(), "default_url": localmodels.DefaultURL(k)})
	}
	return out
}

// PullLocalModel starts downloading a model into an Ollama server and
// returns at once; progress arrives as "model-pull" events.
func (a *App) PullLocalModel(server, model string) error {
	if err := a.ready(); err != nil {
		return err
	}
	key := server + "\x00" + model
	pulls.Lock()
	if _, running := pulls.cancel[key]; running {
		pulls.Unlock()
		return fmt.Errorf("%s is already being pulled", model)
	}
	ctx, cancel := context.WithCancel(context.Background())
	pulls.cancel[key] = cancel
	pulls.Unlock()
	go func() {
		defer func() {
			pulls.Lock()
			delete(pulls.cancel, key)
			pulls.Unlock()
			cancel()
		}()
		last := time.Time{}
		err := a.bot.PullLocalModel(ctx, server, model, func(p localmodels.Progress) {
			if time.Since(last) < 250*time.Millisecond && p.Status != "success" {
				return
			}
			last = time.Now()
			a.emit("model-pull", ModelPullEvent{Server: server, Model: model, Status: p.Status, Completed: p.Completed, Total: p.Total})
		})
		end := ModelPullEvent{Server: server, Model: model, Status: "success", Done: true}
		if err != nil {
			end.Status, end.Error = "failed", err.Error()
			if ctx.Err() != nil {
				end.Status, end.Error = "canceled", ""
			}
		}
		a.emit("model-pull", end)
	}()
	return nil
}

// CancelLocalPull stops a pull.
func (a *App) CancelLocalPull(server, model string) {
	pulls.Lock()
	defer pulls.Unlock()
	if cancel := pulls.cancel[server+"\x00"+model]; cancel != nil {
		cancel()
	}
}

func (a *App) CopyLocalModelWithContext(server, from string, numCtx int) (string, error) {
	if err := a.ready(); err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	return a.bot.CopyLocalModelWithContext(ctx, server, from, numCtx)
}

func (a *App) DeleteLocalModel(server, model string) error {
	if err := a.ready(); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	return a.bot.DeleteLocalModel(ctx, server, model)
}
