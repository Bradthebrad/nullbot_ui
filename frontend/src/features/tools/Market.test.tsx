// The marketplace: versions come from releases, permissions read as plain
// words, and a package with no release seen yet can still be installed.
import {beforeEach, describe, expect, it} from 'vitest';
import {render, screen, within} from '@testing-library/react';
import {installBridge} from '../../test/bridge';
import {appStore} from '../../state/app';
import {ToolsView} from './ToolsView';

beforeEach(() => {
  appStore.set({toolsTab: 'market', ui: undefined} as any);
  installBridge({
    Marketplace: () => ({packages: [
      {id: 'nullbot-web-mcp', kind: 'mcp_server', name: 'NullBot Web MCP', description: 'Web search and browser automation.', release_tag: 'v0.2.0', permissions: ['network_fetch', 'browser_control'], status: 'available', installed: true},
      {id: 'nullbot-emails-mcp', kind: 'mcp_server', name: 'NullBot Email MCP', description: 'Gmail and Outlook.', permissions: ['email_read', 'some_new_thing'], status: 'unreleased'},
      {id: 'api-probe', kind: 'skill_pack', name: 'API Probe Skill', permissions: ['skill_install'], status: 'available'},
    ], dir: '/home/you/.nullbot/market'}),
  });
});

describe('Marketplace', () => {
  it('shows release versions, plain permissions, and notes packages with no release seen', async () => {
    render(<ToolsView />);
    const web = (await screen.findByText('NullBot Web MCP')).closest('tr')!;
    expect(within(web).getByText('v0.2.0')).toBeTruthy();
    expect(within(web).getByText('use the internet')).toBeTruthy();
    expect(within(web).getByText('control a browser')).toBeTruthy();
    expect(within(web).getByRole('button', {name: 'Reinstall'})).toBeTruthy();
    const email = screen.getByText('NullBot Email MCP').closest('tr')!;
    // Install still works: it looks up the newest release itself.
    expect(within(email).getByText('No release seen yet')).toBeTruthy();
    expect(within(email).getByRole('button', {name: 'Install'})).toBeTruthy();
    expect(within(email).getByText('some new thing')).toBeTruthy();
    const skill = screen.getByText('API Probe Skill').closest('tr')!;
    expect(within(skill).getByText('Skill')).toBeTruthy();
    expect(within(skill).getByRole('button', {name: 'Install'})).toBeTruthy();
  });
});
