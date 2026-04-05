import { api } from '../ipc/client';
import type { Conversation, ContextBundle, ConversationMessage } from '../../../shared/types';

let activeConversation = $state<Conversation | null>(null);
let allConversations = $state<Conversation[]>([]);

export function getConversationStore() {
  async function start(contextBundle: ContextBundle, triggerNodeUri?: string, systemMessage?: string): Promise<Conversation> {
    const conv = await api.conversations.create(contextBundle, triggerNodeUri, systemMessage);
    activeConversation = conv;
    return conv;
  }

  async function send(content: string): Promise<Conversation> {
    if (!activeConversation) throw new Error('No active conversation');
    activeConversation = await api.conversations.append(activeConversation.id, 'user', content);
    return activeConversation;
  }

  async function receiveAssistant(content: string): Promise<Conversation> {
    if (!activeConversation) throw new Error('No active conversation');
    activeConversation = await api.conversations.append(activeConversation.id, 'assistant', content);
    return activeConversation;
  }

  async function resolve(): Promise<Conversation> {
    if (!activeConversation) throw new Error('No active conversation');
    activeConversation = await api.conversations.resolve(activeConversation.id);
    const resolved = activeConversation;
    activeConversation = null;
    await refreshList();
    return resolved;
  }

  async function abandon(): Promise<void> {
    if (!activeConversation) return;
    await api.conversations.abandon(activeConversation.id);
    activeConversation = null;
    await refreshList();
  }

  async function resumeConversation(id: string): Promise<Conversation | null> {
    const conv = await api.conversations.load(id);
    if (conv && conv.status === 'active') {
      activeConversation = conv;
    }
    return conv;
  }

  async function refreshList(): Promise<void> {
    allConversations = await api.conversations.list();
  }

  function close(): void {
    activeConversation = null;
  }

  return {
    get active() { return activeConversation; },
    get messages() { return activeConversation?.messages ?? []; },
    get isActive() { return activeConversation !== null && activeConversation.status === 'active'; },
    get all() { return allConversations; },
    start,
    send,
    receiveAssistant,
    resolve,
    abandon,
    resumeConversation,
    refreshList,
    close,
  };
}
