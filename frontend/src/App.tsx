import {useEffect} from 'react';
import {useStore} from './lib/store';
import {api} from './lib/bindings';
import {onActivity, onChanged, onChats, onMCP, onReply, onStatus, onSubmissions, onVisuals} from './lib/events';
import {installLinkInterceptor} from './lib/links';
import {appStore, applyUIState, bumpVersion, openFile, refreshState, setView, toggleInspector} from './state/app';
import {bootstrapChat, handleReply, handleSubmissions, queueActivity} from './state/chat';
import {MAIN_CHAT, chatsStore, cycleTab, focusedChat, groupOfChat, setChats} from './state/chats';
import {closeChat, newChat} from './features/chat/ChatView';
import {Rail, railViews} from './shell/Rail';
import {TopBar} from './shell/TopBar';
import {Palette} from './shell/Palette';
import {ChatView} from './features/chat/ChatView';
import {ActivityView} from './features/activity/ActivityView';
import {FilesView} from './features/files/FilesView';
import {ToolsView} from './features/tools/ToolsView';
import {HistoryView} from './features/history/HistoryView';
import {VisualsView} from './features/visuals/VisualsView';
import {VisualWindow} from './features/visuals/VisualWindow';
import {bootstrapVisuals, handleLiveVisuals} from './state/visuals';
import {SettingsView} from './features/settings/SettingsView';
import {DialogHost} from './ui/dialogs';
import {ErrorBoundary} from './ui/ErrorBoundary';
import {ToastHost, toast, toastError} from './ui/toast';

const viewNames = {chat: 'The conversation', activity: 'Activity', files: 'Files', visuals: 'Visuals', tools: 'Tools', history: 'History', settings: 'Settings'} as const;

export default function App() {
  const ready = useStore(appStore, state => state.ready);
  const error = useStore(appStore, state => state.error);
  const view = useStore(appStore, state => state.view);

  useEffect(() => {
    let disposed = false;
    api.state()
      .then(ui => {
        if (disposed) return;
        applyUIState(ui);
        bootstrapChat(ui.reply);
        appStore.set({ready: true});
        api.chats().then(list => setChats(list || [])).catch(() => setChats([]));
        void bootstrapVisuals();
        if (!ui.models_fresh) api.modelCatalog(false).then(models => appStore.set({models})).catch(() => undefined);
      })
      .catch(err => appStore.set({ready: true, error: String(err instanceof Error ? err.message : err)}));

    let configTimer = 0;
    let mcpTimer = 0;
    const offs = [
      onActivity(queueActivity),
      onReply(handleReply),
      onSubmissions(handleSubmissions),
      onChats(list => setChats(list || [])),
      onVisuals(list => {
        handleLiveVisuals(list);
        bumpVersion('visuals');
      }),
      onMCP(servers => {
        appStore.set({mcp: servers});
        // Views showing one server's details refetch, at most a few times a second.
        window.clearTimeout(mcpTimer);
        mcpTimer = window.setTimeout(() => bumpVersion('mcp'), 400);
      }),
      onChanged(({topic}) => {
        bumpVersion(topic);
        if (topic === 'config') {
          window.clearTimeout(configTimer);
          configTimer = window.setTimeout(() => void refreshState().catch(() => undefined), 150);
        }
      }),
      onStatus(({message}) => toast(message, 'error')),
      installLinkInterceptor({
        openExternal: url => void api.openExternal(url).catch(toastError),
        openLocal: (path, {system}) => (system ? void api.openPath(path).catch(toastError) : openFile(path)),
        blocked: reason => toast(reason, 'error'),
      }),
    ];

    function onKey(event: KeyboardEvent) {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        appStore.set({paletteOpen: !appStore.get().paletteOpen});
      } else if (key === '.') {
        event.preventDefault();
        toggleInspector();
      } else if (key === ',') {
        event.preventDefault();
        setView('settings');
      } else if (/^[1-6]$/.test(key)) {
        event.preventDefault();
        setView(railViews[Number(key) - 1]);
      } else if (key === 't' && !event.shiftKey) {
        event.preventDefault();
        setView('chat');
        void newChat(groupOfChat(chatsStore.get().layout, focusedChat())?.id);
      } else if (key === '\\') {
        event.preventDefault();
        setView('chat');
        void newChat(groupOfChat(chatsStore.get().layout, focusedChat())?.id, 'row');
      } else if (key === 'tab' && appStore.get().view === 'chat') {
        event.preventDefault();
        cycleTab(event.shiftKey ? -1 : 1);
      } else if (key === 'w' && appStore.get().view === 'chat' && focusedChat() !== MAIN_CHAT) {
        event.preventDefault();
        void closeChat(focusedChat());
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      disposed = true;
      window.clearTimeout(configTimer);
      window.clearTimeout(mcpTimer);
      offs.forEach(off => off());
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="app">
      <Rail />
      <div className="frame">
        <TopBar />
        <main className="stage">
          {!ready ? (
            <div className="boot" aria-busy="true"><span className="dot live" />Starting NullBot</div>
          ) : error ? (
            <div className="empty">
              <strong>NullBot couldn’t start.</strong>
              <p>{error}</p>
              <p className="faint">Check the config file in your NullBot folder, then restart the app.</p>
            </div>
          ) : (
            <>
              {/* Chat stays mounted so drafts, attachments and scroll position survive navigation. */}
              <div className="view-slot" hidden={view !== 'chat'}><ErrorBoundary area="The conversation"><ChatView active={view === 'chat'} /></ErrorBoundary></div>
              {view !== 'chat' && (
                <ErrorBoundary area={viewNames[view]} resetKey={view}>
                  {view === 'activity' && <ActivityView />}
                  {view === 'files' && <FilesView />}
                  {view === 'visuals' && <VisualsView />}
                  {view === 'tools' && <ToolsView />}
                  {view === 'history' && <HistoryView />}
                  {view === 'settings' && <SettingsView />}
                </ErrorBoundary>
              )}
            </>
          )}
        </main>
      </div>
      {ready && !error && <ErrorBoundary area="The visual window"><VisualWindow /></ErrorBoundary>}
      <Palette />
      <DialogHost />
      <ToastHost />
    </div>
  );
}
