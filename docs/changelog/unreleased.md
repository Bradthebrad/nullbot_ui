# Unreleased

## Secrets

- **Settings > Secrets**: the encrypted vault's state (how it is protected,
  how many secrets, any file still in plain text), unlocking a passphrase
  vault, and making one on a system without a keychain.
- **GitHub**: save a token and check who it signs in as and its scopes; make
  an Ed25519 SSH key or import one, copy its public key, and add it to the
  token's GitHub account.
- **Every secret** in one table with what it gives commands, whether agents
  may use it (asks before turning on), and which tool servers get it. Add any
  kind: API key, GitHub token, SSH key, AWS, Google Cloud, or another value.
- **Accounts** now says keys are kept in the vault, or names the plain-text
  file on a system that cannot encrypt yet.
- Command palette: *Secrets and GitHub*.

Built on the NullBot vault: see
[NullBot's docs/SECRETS.md](https://github.com/Bradthebrad/nullbot/blob/main/docs/SECRETS.md).
