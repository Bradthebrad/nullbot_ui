package main

import (
	"context"
	"errors"
	"time"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
)

// Secrets and the vault. Bound only to the local Wails UI. Values go in;
// they never come back out: every result is a SecretInfo without values.

func (a *App) ready() error {
	if a.bot == nil || a.initErr != nil {
		return errors.New("NullBot is not running")
	}
	return nil
}

func (a *App) VaultStatus() (nullbot.VaultInfo, error) {
	if err := a.ready(); err != nil {
		return nullbot.VaultInfo{}, err
	}
	return a.bot.VaultStatus(), nil
}

func (a *App) Secrets() ([]nullbot.SecretInfo, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	return a.bot.Secrets()
}

func (a *App) SecretKinds() []nullbot.SecretKindInfo {
	return nullbot.SecretKinds()
}

func (a *App) SaveSecret(input nullbot.SecretInput) (nullbot.SecretInfo, error) {
	if err := a.ready(); err != nil {
		return nullbot.SecretInfo{}, err
	}
	info, err := a.bot.SaveSecret(input)
	for k := range input.Values {
		input.Values[k] = ""
	}
	return info, err
}

func (a *App) RemoveSecret(name string) error {
	if err := a.ready(); err != nil {
		return err
	}
	return a.bot.RemoveSecret(name)
}

func (a *App) GenerateSSHKey(name, host, description string, agentUse bool) (nullbot.SecretInfo, error) {
	if err := a.ready(); err != nil {
		return nullbot.SecretInfo{}, err
	}
	return a.bot.GenerateSSHKey(name, host, description, agentUse)
}

func (a *App) VerifyGitHubToken(name string) (nullbot.GitHubIdentity, error) {
	if err := a.ready(); err != nil {
		return nullbot.GitHubIdentity{}, err
	}
	ctx, cancel := context.WithTimeout(a.context(), 30*time.Second)
	defer cancel()
	return a.bot.VerifyGitHubToken(ctx, name)
}

func (a *App) AddSSHKeyToGitHub(sshName, tokenName string) error {
	if err := a.ready(); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(a.context(), 30*time.Second)
	defer cancel()
	return a.bot.AddSSHKeyToGitHub(ctx, sshName, tokenName, "")
}

func (a *App) CreateVault(protection, passphrase string) (nullbot.VaultInfo, error) {
	if err := a.ready(); err != nil {
		return nullbot.VaultInfo{}, err
	}
	if err := a.bot.CreateVault(protection, passphrase); err != nil {
		return nullbot.VaultInfo{}, err
	}
	return a.bot.VaultStatus(), nil
}

func (a *App) UnlockVault(passphrase string) (nullbot.VaultInfo, error) {
	if err := a.ready(); err != nil {
		return nullbot.VaultInfo{}, err
	}
	if err := a.bot.UnlockVault(passphrase); err != nil {
		return nullbot.VaultInfo{}, err
	}
	return a.bot.VaultStatus(), nil
}

func (a *App) LockVault() (nullbot.VaultInfo, error) {
	if err := a.ready(); err != nil {
		return nullbot.VaultInfo{}, err
	}
	a.bot.LockVault()
	return a.bot.VaultStatus(), nil
}

func (a *App) ReprotectVault(protection, passphrase string) (nullbot.VaultInfo, error) {
	if err := a.ready(); err != nil {
		return nullbot.VaultInfo{}, err
	}
	if err := a.bot.ReprotectVault(protection, passphrase); err != nil {
		return nullbot.VaultInfo{}, err
	}
	return a.bot.VaultStatus(), nil
}

// context is the app's context, or a background one before startup (tests).
func (a *App) context() context.Context {
	if a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}
