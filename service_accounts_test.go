package main

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
)

func TestServiceAccountBridgeUnavailable(t *testing.T) {
	for _, a := range []*App{{}, {initErr: errors.New("sensitive initialization detail")}} {
		if _, err := a.ServiceAccountStatus(); err == nil || strings.Contains(err.Error(), "sensitive") {
			t.Fatal("status must fail closed with a safe error")
		}
		if err := a.SaveServiceAccount(nullbot.ServiceAccountInput{}); err == nil {
			t.Fatal("save must fail before initialization")
		}
		if err := a.DeleteServiceAccount("test"); err == nil {
			t.Fatal("delete must fail before initialization")
		}
	}
}

func TestServiceAccountInitialReleasePolicy(t *testing.T) {
	for _, service := range []string{"gmail", "outlook", "google_drive", "onedrive"} {
		input := nullbot.ServiceAccountInput{Service: service, Fields: map[string]string{"access_token": "dummy"}}
		if !serviceAccountInputSupported(input) {
			t.Fatalf("access token rejected for %s", service)
		}
		for _, key := range []string{"refresh_token", "client_id", "client_secret", "tenant", "unknown"} {
			input.Fields[key] = "dummy"
			if serviceAccountInputSupported(input) {
				t.Fatalf("unsupported field accepted for %s: %s", service, key)
			}
			delete(input.Fields, key)
		}
	}
	for _, service := range []string{"yahoo", "icloud_mail", "skype", "imessage", "unknown"} {
		if serviceAccountInputSupported(nullbot.ServiceAccountInput{Service: service}) {
			t.Fatalf("unavailable service accepted: %s", service)
		}
	}
	// Compare the same credential-free fixture used by frontend regression tests.
	// This catches drift in either the UI policy or the read-only backend contract.
	data, err := os.ReadFile("frontend/tests/fixtures/service-account-catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	var expected []nullbot.ServiceDefinition
	if err := json.Unmarshal(data, &expected); err != nil {
		t.Fatal(err)
	}
	actual := (&App{}).ServiceAccountCatalog()
	if len(actual) != len(expected) {
		t.Fatal("backend service catalog changed; review UI availability")
	}
	for i, service := range actual {
		want := expected[i]
		if service.ID != want.ID || service.ServerID != want.ServerID || len(service.Fields) != len(want.Fields) {
			t.Fatalf("backend catalog mismatch for %s", want.ID)
		}
		for j, field := range service.Fields {
			field.Label = "" // Human-readable wording is not part of the wire policy.
			if field != want.Fields[j] {
				t.Fatalf("backend field mismatch for %s/%s", service.ID, field.Key)
			}
			if !serviceAccountInputSupported(nullbot.ServiceAccountInput{Service: service.ID, Fields: map[string]string{field.Key: "dummy"}}) {
				t.Fatalf("UI bridge rejected catalog field %s/%s", service.ID, field.Key)
			}
		}
		if serviceAccountInputSupported(nullbot.ServiceAccountInput{Service: service.ID, Fields: map[string]string{"unknown": "dummy"}}) {
			t.Fatalf("UI bridge accepted unknown field for %s", service.ID)
		}
	}
}

func TestNewProviderBridgeRejectsUnsafeInputsBeforeStore(t *testing.T) {
	a := &App{bot: nullbot.New(nullbot.Config{AppDir: t.TempDir()})}
	for _, input := range []nullbot.ServiceAccountInput{
		{Service: "gmail_imap", Fields: map[string]string{"email": "not-an-email", "app_password": "synthetic-secret"}},
		{Service: "gmail_imap", Fields: map[string]string{"email": "fixture@example.com", "app_password": "synthetic-secret", "host": "remote.example"}},
		{Service: "discord", Fields: map[string]string{"bot_token": ""}},
		{Service: "discord", Fields: map[string]string{"user_token": "synthetic-secret"}},
		{Service: "telegram", Fields: map[string]string{"bot_token": "synthetic-secret"}},
		{Service: "telegram", Fields: map[string]string{"bot_token": "123:synthetic_URL-safe-token_0123456789", "offset": "1"}},
		{Service: "signal", Fields: map[string]string{"bridge_url": "http://remote.example:8080", "number": "+15551234567", "api_token": "synthetic-secret"}},
		{Service: "signal", Fields: map[string]string{"bridge_url": "http://127.0.0.1:8080", "number": "bad", "api_token": "synthetic-secret"}},
		// Connector contract drift: these formerly passed account validation.
		{Service: "signal", Fields: map[string]string{"bridge_url": "http://127.0.0.1:8080/", "number": "+15551234567"}},
		{Service: "signal", Fields: map[string]string{"bridge_url": "http://[::1]:8080/", "number": "+15551234567"}},
		{Service: "signal", Fields: map[string]string{"bridge_url": "http://127.0.0.1:8080", "number": "+123456"}},
		{Service: "signal", Fields: map[string]string{"bridge_url": "http://127.0.0.1:8080", "number": "+15551234567", "api_token": "synthetic:token"}},
		{Service: "signal", Fields: map[string]string{"bridge_url": "http://127.0.0.1:8080", "number": "+15551234567", "api_token": strings.Repeat("x", 4097)}},
		{Service: "discord", Fields: map[string]string{"bot_token": "synthetic-discord-token"}},
		{Service: "discord", Fields: map[string]string{"bot_token": "mfa.synthetic_token.signature"}},
		{Service: "discord", Fields: map[string]string{"bot_token": "a.b." + strings.Repeat("x", 253)}},
		{Service: "telegram", Fields: map[string]string{"bot_token": "123:short"}},
		{Service: "telegram", Fields: map[string]string{"bot_token": "01:" + strings.Repeat("x", 30)}},
		{Service: "telegram", Fields: map[string]string{"bot_token": "1:" + strings.Repeat("x", 129)}},
		{Service: "gmail_imap", Fields: map[string]string{"email": "fixturé@example.com", "app_password": "synthetic-secret"}},
		{Service: "gmail_imap", Fields: map[string]string{"email": "fixture@example.com", "app_password": strings.Repeat("x ", 257)}},
		{Service: "gmail_imap", Fields: map[string]string{"email": "fixture@example.com", "app_password": "syntheticé"}},
	} {
		input.Label = "Fixture"
		err := a.SaveServiceAccount(input)
		if err == nil || strings.Contains(err.Error(), "synthetic") || strings.Contains(err.Error(), "remote.example") {
			t.Fatalf("unsafe input not rejected with sanitized error for %s", input.Service)
		}
	}
}

func TestServiceAccountStatusWireContractContainsNoCredentials(t *testing.T) {
	state := nullbot.ServiceAccountState{
		Services: []nullbot.ServiceStatus{{Service: "gmail", ServerID: "nullbot-emails-mcp", Status: "configured_unverified"}},
		Accounts: []nullbot.ServiceAccountInfo{{ID: "one", Service: "gmail", Label: "Work", Status: "configured_unverified", AllowWrite: false}},
	}
	data, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string][]map[string]any
	if err := json.Unmarshal(data, &wire); err != nil {
		t.Fatal(err)
	}
	want := map[string][]map[string]any{
		"services": {{"service": "gmail", "server_id": "nullbot-emails-mcp", "status": "configured_unverified"}},
		"accounts": {{"id": "one", "service": "gmail", "label": "Work", "status": "configured_unverified", "allow_write": false}},
	}
	if !reflect.DeepEqual(wire, want) {
		t.Fatal("metadata-only wire contract changed; review frontend types and credential exposure")
	}
	for _, forbidden := range []string{"fields", "access_token", "refresh_token", "password", "configured\"", "installed\""} {
		if strings.Contains(string(data), forbidden) {
			t.Fatalf("unexpected status field %s", forbidden)
		}
	}
}

func TestServiceAccountBridgeRejectsBeforeStoreAndSanitizesErrors(t *testing.T) {
	// No store operations: backend validation rejects before accessing its vault.
	a := &App{bot: nullbot.New(nullbot.Config{AppDir: t.TempDir()})}
	input := nullbot.ServiceAccountInput{Service: "gmail", Label: "Work", Fields: map[string]string{"refresh_token": "sensitive-fixture"}}
	if err := a.SaveServiceAccount(input); err == nil || strings.Contains(err.Error(), "sensitive-fixture") {
		t.Fatal("unsupported input must fail safely")
	}
	input.Fields = map[string]string{"access_token": ""}
	if err := a.SaveServiceAccount(input); err == nil || strings.Contains(err.Error(), "sensitive-fixture") {
		t.Fatal("invalid input must fail safely")
	}
	if err := a.DeleteServiceAccount("invalid/id"); err == nil || strings.Contains(err.Error(), "invalid/id") {
		t.Fatal("delete must not echo input")
	}
}
