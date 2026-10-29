# Unreleased

## Cloud

- **Cloud** in the rail: machines and buckets NullBot made on AWS and
  Google Cloud, what they cost per hour, and the plans that made them. A
  dot on the rail says when a plan is waiting for you, and an agent's
  proposal is announced.
- **Approving a plan**: why it was asked for, what it makes, its cost, and
  every command numbered in the order it runs, quoted as a shell needs it,
  with values from earlier steps named. A first-boot script someone wrote
  is open for reading. **Approve and run** or **Reject** sit under the
  commands, and approving covers exactly the plan on screen; a removal asks
  first. Agents can propose plans (when allowed) but never approve them.
- **Machines**: address, who can reach which port, first-boot setup, cost,
  and what runs there, read over SSH; open a tunnel to a port, or use the
  machine's Ollama as a model server here. Removing anything proposes a
  plan.
- **This computer** lists what listens on which port and whether other
  computers can reach it; the **Ledger** lists every proposal, decision and
  command.

## Local models

- **Settings > Models > Model servers**: add Ollama, llama.cpp, LM Studio,
  vLLM or any OpenAI-compatible server, here or on another machine, or find
  the ones running here. Each shows whether it answers, its chat models
  with their real context, and a warning when that is too small; Ollama
  models can be pulled (with progress and cancel), deleted, or copied with
  a larger context.
- **Install a model**: the models that run well on this computer, ranked by
  llmfit, and a Hugging Face search for GGUF builds, installed into Ollama,
  LM Studio's folder or NullBot's models folder.

## Claude CLI models

- **Claude subscription models** (CLI default, Opus, Sonnet, Haiku) in the
  model pickers, through your installed `claude` command. Settings >
  Accounts shows whether it is installed and signed in.
- **Claude's own steps in the activity panel**, in plain words ("Read
  main.go", "Run the tests", "Searched for “TODO”").
- **What Claude says before using a tool** moves into the step commentary
  instead of showing twice; this also applies to other models that comment
  before a tool call.

## Chats

- **Several chats at once**, each with its own conversation, queue, run
  controls and subagents, in tabs and in side-by-side or stacked groups.
  Drag a tab to another group or to a group's edge to split; drag the border
  between groups to resize. The layout is remembered.
- **The main chat steers the others**: it lists every chat and its
  subagents, reads one, sends or queues a request, steers a running request
  or a subagent, pauses or stops a chat, and opens new chats for parallel
  work.
- **Activity panel > Chats** shows every chat's state, request and subagents
  with Pause and Stop. The top bar, palette and activity panel follow the
  focused chat; a chip says when other chats are working.
- **History > Continue** opens the saved conversation in a chat of its own
  instead of replacing the one on screen. Open chats come back after a
  restart.
- Activity > Runs lists every chat's subagents, labelled with their chat.
- Keys: `Ctrl+T`, `Ctrl+\`, `Ctrl+Tab`, `Ctrl+W`.

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
