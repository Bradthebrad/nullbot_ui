// Which chat a pane shows. Components inside a pane read and act on that
// chat; the top bar, palette and activity panel follow the focused chat.
import {createContext, useContext, type ReactNode} from 'react';
import {useStore} from '../../lib/store';
import {chatSession, type ChatSession, type ChatState} from '../../state/chat';
import {MAIN_CHAT, chatsStore, focusedChat} from '../../state/chats';

const ChatContext = createContext<string>(MAIN_CHAT);

export function ChatProvider({chat, children}: {chat: string; children: ReactNode}) {
  return <ChatContext.Provider value={chat}>{children}</ChatContext.Provider>;
}

/** The pane's chat. */
export function useChat(): ChatSession {
  return chatSession(useContext(ChatContext));
}

/** A slice of the pane's chat state. */
export function useChatState<S>(selector: (state: ChatState) => S, equal?: (a: S, b: S) => boolean): S {
  return useStore(useChat().store, selector, equal);
}

/** The focused chat, for controls outside the panes. */
export function useFocusedChat(): ChatSession {
  return chatSession(useStore(chatsStore, state => focusedChat(state)));
}

export function useFocusedChatState<S>(selector: (state: ChatState) => S, equal?: (a: S, b: S) => boolean): S {
  return useStore(useFocusedChat().store, selector, equal);
}
