package main

import (
	"sync"
	"time"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
)

const (
	streamFlushInterval = 33 * time.Millisecond
	changeDebounce      = 120 * time.Millisecond
)

// activityBatcher coalesces streamed token fragments into at most one IPC
// message per frame. Non-delta records (tool calls, lifecycle) flush
// immediately, after any pending fragments, so ordering is preserved.
type activityBatcher struct {
	mu      sync.Mutex
	pending []nullbot.ActivityRecord
	timer   *time.Timer
	emit    func([]nullbot.ActivityRecord)
}

func newActivityBatcher(emit func([]nullbot.ActivityRecord)) *activityBatcher {
	return &activityBatcher{emit: emit}
}

func sameStream(a, b nullbot.ActivityRecord) bool {
	return a.Status == b.Status && a.Kind == b.Kind && a.SubmissionID == b.SubmissionID && a.AgentID == b.AgentID && a.RunID == b.RunID && a.Lane == b.Lane && a.TaskID == b.TaskID && a.ParentRunID == b.ParentRunID
}

func (b *activityBatcher) add(record nullbot.ActivityRecord) {
	b.mu.Lock()
	n := len(b.pending)
	if record.IsStreamDelta() && n > 0 && sameStream(b.pending[n-1], record) {
		b.pending[n-1].Detail += record.Detail
		b.pending[n-1].Seq = record.Seq
	} else {
		b.pending = append(b.pending, record)
	}
	if !record.IsStreamDelta() {
		batch := b.takeLocked()
		b.mu.Unlock()
		b.emit(batch)
		return
	}
	if b.timer == nil {
		b.timer = time.AfterFunc(streamFlushInterval, b.flush)
	}
	b.mu.Unlock()
}

func (b *activityBatcher) takeLocked() []nullbot.ActivityRecord {
	batch := b.pending
	b.pending = nil
	if b.timer != nil {
		b.timer.Stop()
		b.timer = nil
	}
	return batch
}

func (b *activityBatcher) flush() {
	b.mu.Lock()
	batch := b.takeLocked()
	b.mu.Unlock()
	if len(batch) > 0 {
		b.emit(batch)
	}
}

// changeDebouncer turns bursts of change notifications into one callback per
// topic per debounce window.
type changeDebouncer struct {
	mu     sync.Mutex
	timers map[string]*time.Timer
	fire   func(topic string)
}

func newChangeDebouncer(fire func(string)) *changeDebouncer {
	return &changeDebouncer{timers: map[string]*time.Timer{}, fire: fire}
}

func (d *changeDebouncer) notify(topic string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, pending := d.timers[topic]; pending {
		return
	}
	d.timers[topic] = time.AfterFunc(changeDebounce, func() {
		d.mu.Lock()
		delete(d.timers, topic)
		d.mu.Unlock()
		d.fire(topic)
	})
}

func (d *changeDebouncer) stop() {
	d.mu.Lock()
	defer d.mu.Unlock()
	for topic, timer := range d.timers {
		timer.Stop()
		delete(d.timers, topic)
	}
}

// publishChange emits the snapshot the UI needs for a topic. Small snapshots
// are pushed directly; large ones are announced and fetched on demand.
func (a *App) publishChange(topic string) {
	switch topic {
	case nullbot.ChangeSubmissions:
		a.emit("submissions", a.bot.SubmissionState())
	case nullbot.ChangeMCP:
		a.emit("mcp", a.bot.MCPStatus(false))
	case nullbot.ChangeVisuals:
		a.emit("visuals", a.bot.LiveVisualizations())
	default:
		a.emit("changed", map[string]string{"topic": topic})
	}
}
