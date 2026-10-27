export type ServiceField = {key: string; label: string; secret?: boolean; optional?: boolean};
export type ServiceDefinition = {id: string; name: string; packageID: string; detail: string; help: string[]; fields: ServiceField[]; unavailable?: boolean};
// Metadata-only backend contract. Never add credential fields to status types.
export type ServiceAvailability = {service: string; server_id: string; status: string};
export type ServiceAccountSummary = {id: string; service: string; label: string; status: string; allow_write: boolean};
export type ServiceAccountsState = {services: ServiceAvailability[]; accounts: ServiceAccountSummary[]};
export type SaveServiceAccountRequest = {id: string; service: string; label: string; fields: Record<string, string>; allow_write: boolean};
const oauthFields: ServiceField[] = [{key: 'access_token', label: 'Access token', secret: true}];
const manualOAuth = 'This initial setup is manual: use your own OAuth client and consent flow outside NullBot, then paste only an access token here. NullBot does not open a login flow, verify tokens, or support automatic token refresh. When a token expires, replace it manually. Never paste credentials into chat.';
export const serviceDefinitions: ServiceDefinition[] = [
  {id: 'gmail', name: 'Gmail', packageID: 'nullbot-emails-mcp', detail: 'Gmail API using your own OAuth credentials.', fields: oauthFields, help: [
    'In Google Cloud, create a project, enable the Gmail API, configure the OAuth consent screen and your own OAuth client. Add your account as a test user if required.',
    'Grant only the permissions needed (gmail.readonly for reading; gmail.send only if you intend to send).', manualOAuth]},
  {id: 'gmail_imap', name: 'Gmail (IMAP/SMTP)', packageID: 'nullbot-emails-mcp', detail: 'Gmail app password with fixed TLS Gmail IMAP/SMTP endpoints. Separate from Gmail API OAuth.', fields: [{key: 'email', label: 'Gmail email address'}, {key: 'app_password', label: 'Google app password', secret: true}], help: [
    'Enable Google 2-Step Verification and create an app password outside NullBot if your account policy allows it. Enter your full Gmail or Google Workspace email address and the app password, not your normal Google password.',
    'Use a bare ASCII email address of at most 254 characters. ASCII spaces are stripped from the app password; the result must contain 1–256 printable ASCII characters.',
    'Uses only fixed TLS Gmail IMAP/SMTP endpoints; arbitrary mail servers, insecure connections and OAuth login/refresh are not configured here. Workspace administrators may restrict app passwords or mail access.',
    'The existing Gmail API tile remains available for manually supplied OAuth access tokens. Sending requires write permission and confirmation. Saving does not verify credentials or send mail.']},
  {id: 'outlook', name: 'Outlook / Microsoft 365', packageID: 'nullbot-emails-mcp', detail: 'Microsoft Graph mail, subject to account and tenant policies.', fields: oauthFields, help: [
    'Register your own application in Microsoft Entra ID. Choose the supported account types and configure a redirect URI for your OAuth flow.',
    'Use delegated Microsoft Graph Mail.Read for reading and Mail.Send only for sending. Your organization may require administrator consent.', manualOAuth]},
  {id: 'yahoo', name: 'Yahoo Mail', packageID: 'nullbot-emails-mcp', unavailable: true, fields: [], detail: 'Unavailable in this initial release. Yahoo IMAP/SMTP is not supported yet.', help: ['This release does not provide Yahoo mail access. No credentials can be added or replaced here.']},
  {id: 'icloud_mail', name: 'iCloud Mail', packageID: 'nullbot-emails-mcp', unavailable: true, fields: [], detail: 'Unavailable in this initial release. iCloud Mail IMAP/SMTP is not supported yet.', help: ['This release does not provide iCloud mail access. No credentials can be added or replaced here. This is separate from local synced-folder iCloud Drive access.']},
  {id: 'google_drive', name: 'Google Drive', packageID: 'nullbot-drives-mcp', detail: 'Google Drive API using your own OAuth credentials.', fields: oauthFields, help: [
    'In Google Cloud, enable the Google Drive API and configure your own OAuth consent screen and client.',
    'Request the narrowest scope suitable for your work, such as drive.readonly for reading or drive.file for selected app-managed files. Broader scopes can require additional verification.', manualOAuth]},
  {id: 'onedrive', name: 'OneDrive', packageID: 'nullbot-drives-mcp', detail: 'Microsoft Graph files with delegated OAuth access.', fields: oauthFields, help: [
    'Register your own application in Microsoft Entra ID and configure the account types and redirect URI for your OAuth flow.',
    'Use delegated Files.Read for reading; request Files.ReadWrite only if needed. Work or school accounts may need administrator consent.', manualOAuth]},
  {id: 'icloud_drive', name: 'iCloud Drive (local)', packageID: 'nullbot-drives-mcp', detail: 'Local synced-folder access only. Not an Apple cloud login or remote iCloud API.', fields: [{key: 'root', label: 'Absolute local iCloud Drive folder path'}], help: [
    'Install and configure Apple’s iCloud sync software yourself, outside NullBot. Locate your local iCloud Drive folder and ensure the files you need are downloaded, not cloud-only placeholders.',
    'Enter the absolute local folder path as root. Access is limited to that local tree; sync availability is controlled by Apple’s software. NullBot cannot sign in to Apple or browse remote-only iCloud data. Write operations can sync changes or deletions to other devices.']},
  {id: 'twilio', name: 'Twilio', packageID: 'nullbot-messages-mcp', detail: 'Twilio SMS via your account and sender number. Usage can incur charges.', fields: [{key: 'account_sid', label: 'Account SID', secret: true}, {key: 'auth_token', label: 'Auth token', secret: true}, {key: 'from', label: 'Twilio sender (E.164 number)'}], help: [
    'In your Twilio Console, obtain your Account SID and Auth Token and choose a provisioned SMS-capable sender. Enter the sender number in E.164 format (for example +15551234567).',
    'Trial accounts, recipient verification, regional rules and messaging registration may limit delivery. Sending messages incurs Twilio/provider charges and requires write permission. Saving does not send a test message.']},
  {id: 'whatsapp', name: 'WhatsApp Business', packageID: 'nullbot-messages-mcp', detail: 'Meta WhatsApp Business Cloud API only — not your personal WhatsApp inbox.', fields: [{key: 'access_token', label: 'Meta access token', secret: true}, {key: 'phone_number_id', label: 'Business phone number ID'}, {key: 'api_version', label: 'Supported Graph API version (for example v23.0)'}], help: [
    'Create/configure your own Meta developer app with WhatsApp Business Cloud API, a WhatsApp Business Account and a registered business phone number. Obtain a token with the permissions required by your approved app.',
    'Enter the API phone number ID (not the phone number itself), access token and a currently supported Graph API version. Token lifetime and permission requirements depend on your Meta app setup.',
    'This is not access to personal WhatsApp chats or historical personal inbox messages. Inbound business messages require a separately configured webhook; saving here does not create one. Templates, opt-in, messaging windows, approval requirements and Meta fees may apply. Sending requires write permission.']},
  {id: 'discord', name: 'Discord (bot)', packageID: 'nullbot-messages-mcp', detail: 'Bot channel read/send only. No selfbot or personal account login.', fields: [{key: 'bot_token', label: 'Discord bot token', secret: true}], help: [
    'Create a bot in the Discord Developer Portal and authorize it for the intended server outside NullBot. Paste only the bot token, not a user token. Grant only the channel permissions needed (view channel/read message history for reads; send messages for sends).',
    'The bot token must be 20–256 characters in three nonempty dot-separated segments of URL-safe letters, digits, underscores or hyphens. Tokens starting with mfa. are rejected.',
    'Message content availability depends on Discord permissions and message-content intent policy. This is not access to your personal Discord inbox. Sending requires write permission and confirmation; saving does not contact Discord.']},
  {id: 'telegram', name: 'Telegram (bot)', packageID: 'nullbot-messages-mcp', detail: 'Bot pending updates and numeric chat-ID sends, not personal chat history.', fields: [{key: 'bot_token', label: 'Telegram bot token', secret: true}], help: [
    'Create a bot using BotFather outside NullBot. Enter its bot token: a 1–20 digit bot ID starting with 1–9, a colon, then 30–128 URL-safe letters, digits, underscores or hyphens. Never use a personal account session or login code.',
    'Reading shows pending bot updates only, not chat history. NullBot does not acknowledge updates or advance an offset, so reads may repeat. An active webhook can prevent polling; saving does not configure or remove webhooks.',
    'Send only to numeric chat IDs for chats the bot can access; usernames are not supported. Users must first interact with the bot or add it to an appropriate chat. Privacy mode and permissions limit visibility. Sending requires write permission and confirmation.']},
  {id: 'signal', name: 'Signal (unofficial bridge)', packageID: 'nullbot-messages-mcp', detail: 'Outbound only via a separately installed signal-cli-rest-api bridge. Unofficial integration.', fields: [{key: 'bridge_url', label: 'Loopback bridge URL with explicit port'}, {key: 'number', label: 'Signal sender (E.164 number)'}, {key: 'api_token', label: 'Bridge API token', secret: true, optional: true}], help: [
    'Unofficial: use a separately installed and configured signal-cli-rest-api bridge. NullBot does not install it, register a number, link a device, log in to Signal, or read your inbox. Complete any bridge setup yourself outside NullBot.',
    'Only http://127.0.0.1:<port> or http://[::1]:<port> is accepted, with an explicit port from 1 to 65535 and no trailing slash. No credentials in URLs, hostnames, remote hosts, paths, queries or fragments. Bind the bridge only to loopback and secure it against other local processes.',
    'Enter the bridge sender number in E.164 format: + and 7–15 digits starting with 1–9 (for example +15551234567). The optional API token is secret and limited to 4096 characters: letters, digits, dot, underscore, tilde, plus, slash or hyphen, with optional trailing = padding; blank or omitted on replacement removes the old token. Local HTTP is not TLS. Sending requires write permission and confirmation; saving makes no bridge request.']},
  {id: 'skype', name: 'Skype', packageID: '', unavailable: true, fields: [], detail: 'Unavailable. Consumer Skype is retired; there is no supported personal-inbox integration here.', help: ['Consumer Skype was retired in May 2025. No supported Skype account connector is provided. Microsoft Teams is a separate product and is not configured by this tile.']},
  {id: 'imessage', name: 'iMessage', packageID: '', unavailable: true, fields: [], detail: 'Unavailable. Apple provides no supported general-purpose iMessage API for this Windows integration.', help: ['There is no supported iMessage account API in this integration. This tile does not use private APIs, bridge a Mac, or read your personal Messages database.']},
];
export function localStatus(status?: string): string {
  switch (status) {
    case 'not_installed': return 'MCP not installed';
    case 'disabled': return 'MCP disabled';
    case 'not_configured': return 'No local credentials configured';
    case 'configured_unverified': return 'Configured locally — unverified';
    default: return 'Local status unavailable';
  }
}
export function serviceStatus(service: ServiceDefinition, availability?: ServiceAvailability): string {
  if (service.unavailable) return 'Unavailable in this release';
  return localStatus(availability?.status);
}
