package main

import (
	"errors"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
)

// These methods are bound only to the same-user local Wails UI. They are not
// model tools and must never log inputs, emit credentials, or contact providers.
func (a *App) ServiceAccountCatalog() []nullbot.ServiceDefinition {
	return nullbot.ServiceAccountCatalog()
}

func (a *App) ServiceAccountStatus() (nullbot.ServiceAccountState, error) {
	if a.bot == nil || a.initErr != nil {
		return nullbot.ServiceAccountState{}, errors.New("local service account settings unavailable")
	}
	state, err := a.bot.ServiceAccountStatus()
	if err != nil {
		return nullbot.ServiceAccountState{}, errors.New("could not read local service account status")
	}
	return state, nil
}

func (a *App) SaveServiceAccount(input nullbot.ServiceAccountInput) error {
	if a.bot == nil || a.initErr != nil {
		return errors.New("local service account settings unavailable")
	}
	// OAuth remains access-token-only; new adapters accept only the explicitly
	// supported fields below. No personal messaging login or arbitrary mail host.
	if !serviceAccountInputSupported(input) {
		return errors.New("unsupported service account fields for this release")
	}
	if err := a.bot.SaveServiceAccount(input); err != nil {
		return errors.New("could not save local service account; check required fields and store permissions")
	}
	return nil
}

func (a *App) DeleteServiceAccount(id string) error {
	if a.bot == nil || a.initErr != nil {
		return errors.New("local service account settings unavailable")
	}
	if err := a.bot.DeleteServiceAccount(id); err != nil {
		return errors.New("could not delete local service account")
	}
	return nil
}

func serviceAccountInputSupported(input nullbot.ServiceAccountInput) bool {
	var keys []string
	switch input.Service {
	case "gmail", "outlook", "google_drive", "onedrive":
		keys = []string{"access_token"}
	case "gmail_imap":
		keys = []string{"email", "app_password"}
	case "discord", "telegram":
		keys = []string{"bot_token"}
	case "signal":
		keys = []string{"bridge_url", "number", "api_token"}
	case "icloud_drive":
		keys = []string{"root"}
	case "twilio":
		keys = []string{"account_sid", "auth_token", "from"}
	case "whatsapp":
		keys = []string{"access_token", "phone_number_id", "api_version"}
	default:
		return false
	}
	for key := range input.Fields {
		allowed := false
		for _, candidate := range keys {
			if candidate == key {
				allowed = true
				break
			}
		}
		if !allowed {
			return false
		}
	}
	return true
}
