import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  FileText,
  Lock,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { db } from '../lib/db';
import { mapMessage } from '../lib/mappers';
import { supabase } from '../lib/supabaseClient';
import { showToast, errorMessage } from '../lib/toast';
import { uploadChatFile, MAX_UPLOAD_BYTES } from '../lib/storage';
import { ROLE_BADGE_CLASSES_SOFT, ROLE_LABEL } from '../lib/roles';
import { ChatMessage, ConversationSummary, Task } from '../types';

interface ChatViewProps {
  onOpenTaskModal: (task: Task) => void;
}

export const ChatView: React.FC<ChatViewProps> = ({ onOpenTaskModal }) => {
  const {
    currentUser,
    users,
    tasks,
    conversations,
    chatDeepLinkConversationId,
    clearChatDeepLink,
    canStartGroupChat,
    markConversationRead,
    startDirectConversation,
    startGroupConversation,
    refreshConversations,
  } = useApp();

  const usersById = useMemo(() => {
    const map: Record<string, (typeof users)[number]> = {};
    users.forEach((u) => (map[u.id] = u));
    return map;
  }, [users]);

  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [messageEncrypted, setMessageEncrypted] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<{ url: string; name: string; kind: 'image' | 'file' } | null>(null);
  const [revealedMessages, setRevealedMessages] = useState<Record<string, boolean>>({});

  const [isNewConvOpen, setIsNewConvOpen] = useState(false);
  const [newConvMode, setNewConvMode] = useState<'direct' | 'group'>('direct');
  const [groupName, setGroupName] = useState('');
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [isCreatingConv, setIsCreatingConv] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  const selectedConversation = conversations.find((c) => c.id === selectedConversationId) || null;

  // Deep link from "Discuss this task" — open the conversation the moment it's ready.
  useEffect(() => {
    if (chatDeepLinkConversationId) {
      setSelectedConversationId(chatDeepLinkConversationId);
      clearChatDeepLink();
    }
  }, [chatDeepLinkConversationId, clearChatDeepLink]);

  // Load history + mark read whenever the selected conversation changes.
  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setIsLoadingMessages(true);
    db.getMessages(selectedConversationId)
      .then((rows) => {
        if (cancelled) return;
        setMessages(rows.map((r) => mapMessage(r, usersById)));
      })
      .catch((err) => showToast('error', `Couldn't load messages: ${errorMessage(err)}`))
      .finally(() => {
        if (!cancelled) setIsLoadingMessages(false);
      });
    markConversationRead(selectedConversationId);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversationId]);

  // Live-append new messages in the open thread (Realtime, filtered to this conversation).
  useEffect(() => {
    if (!selectedConversationId) return;
    const channel = supabase
      .channel(`aviyana-chat-thread-${selectedConversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedConversationId}` },
        (payload) => {
          const row = payload.new as Parameters<typeof mapMessage>[0];
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, mapMessage(row, usersById)]));
          if (row.sender_id !== currentUser.id) markConversationRead(selectedConversationId);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversationId, usersById]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSelectConversation = (id: string) => {
    setSelectedConversationId(id);
    setMessageText('');
    setMessageEncrypted(false);
    setPendingAttachment(null);
  };

  const handleAttachFile = async (file: File | undefined) => {
    if (!file || !selectedConversationId) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      showToast('error', 'File is too large (25MB max).');
      return;
    }
    setIsUploadingAttachment(true);
    try {
      const { url, kind } = await uploadChatFile(selectedConversationId, file);
      setPendingAttachment({ url, name: file.name, kind });
    } catch (err) {
      showToast('error', `Couldn't upload that file: ${errorMessage(err)}`);
    } finally {
      setIsUploadingAttachment(false);
      if (chatFileInputRef.current) chatFileInputRef.current.value = '';
    }
  };

  const handleSend = async () => {
    if ((!messageText.trim() && !pendingAttachment) || !selectedConversationId || isSending) return;
    setIsSending(true);
    try {
      const row = await db.sendMessage(selectedConversationId, messageText.trim(), messageEncrypted, pendingAttachment);
      setMessages((prev) => [...prev, mapMessage(row, usersById)]);
      setMessageText('');
      setMessageEncrypted(false);
      setPendingAttachment(null);
      refreshConversations();
    } catch (err) {
      showToast('error', `Couldn't send that message: ${errorMessage(err)}`);
    } finally {
      setIsSending(false);
    }
  };

  const toggleReveal = (messageId: string) => {
    setRevealedMessages((prev) => ({ ...prev, [messageId]: !prev[messageId] }));
  };

  const openNewConversation = () => {
    setNewConvMode('direct');
    setGroupName('');
    setGroupMemberIds([]);
    setIsNewConvOpen(true);
  };

  const handleStartDirect = async (otherUserId: string) => {
    setIsCreatingConv(true);
    try {
      const id = await startDirectConversation(otherUserId);
      setIsNewConvOpen(false);
      setSelectedConversationId(id);
    } catch {
      // startDirectConversation already toasted the error.
    } finally {
      setIsCreatingConv(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || groupMemberIds.length === 0 || isCreatingConv) return;
    setIsCreatingConv(true);
    try {
      const id = await startGroupConversation(groupName.trim(), groupMemberIds);
      setIsNewConvOpen(false);
      setSelectedConversationId(id);
    } catch {
      // startGroupConversation already toasted the error.
    } finally {
      setIsCreatingConv(false);
    }
  };

  const toggleGroupMember = (userId: string) => {
    setGroupMemberIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };

  const relatedTask = selectedConversation?.relatedTaskId
    ? tasks.find((t) => t.id === selectedConversation.relatedTaskId)
    : undefined;

  const avatarFor = (c: ConversationSummary) =>
    c.type === 'group' ? null : c.otherMember?.avatar;

  return (
    <div className="h-[calc(100vh-8.5rem)] lg:h-[calc(100vh-7.5rem)] flex rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
      {/* Conversation list */}
      <div
        className={`w-full sm:w-72 flex-shrink-0 border-r border-slate-100 dark:border-slate-800 flex flex-col ${
          selectedConversationId ? 'hidden sm:flex' : 'flex'
        }`}
      >
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
            <MessageSquare className="w-4 h-4 text-blue-500" />
            Chat
          </h2>
          <button
            id="new-conversation-btn"
            onClick={openNewConversation}
            className="p-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            aria-label="New conversation"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && (
            <p className="p-4 text-xs text-slate-400 italic">
              No conversations yet — start one with the + button above.
            </p>
          )}
          {conversations.map((c) => {
            const avatar = avatarFor(c);
            const isActive = c.id === selectedConversationId;
            return (
              <button
                key={c.id}
                onClick={() => handleSelectConversation(c.id)}
                className={`w-full text-left px-4 py-3 flex items-center gap-3 border-b border-slate-50 dark:border-slate-800/60 transition-colors ${
                  isActive ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                {avatar ? (
                  <img src={avatar} alt={c.name} className="w-9 h-9 rounded-xl object-cover flex-shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center flex-shrink-0">
                    <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{c.name}</p>
                    {c.unreadCount > 0 && (
                      <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">
                    {c.lastMessageIsEncrypted
                      ? '🔒 Confidential message'
                      : c.lastMessageText ?? 'No messages yet'}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Thread */}
      <div className={`flex-1 min-w-0 flex flex-col ${selectedConversationId ? 'flex' : 'hidden sm:flex'}`}>
        {!selectedConversation ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-xs gap-2">
            <MessageSquare className="w-5 h-5" />
            Select a conversation to start chatting.
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
              <button
                onClick={() => setSelectedConversationId(null)}
                className="sm:hidden p-1.5 -ml-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                aria-label="Back to conversations"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              {avatarFor(selectedConversation) ? (
                <img
                  src={avatarFor(selectedConversation) as string}
                  alt={selectedConversation.name}
                  className="w-8 h-8 rounded-xl object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center">
                  <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                  {selectedConversation.name}
                </p>
                {selectedConversation.type === 'group' ? (
                  <p className="text-[11px] text-slate-400">{selectedConversation.memberIds.length} members</p>
                ) : selectedConversation.otherMember ? (
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      ROLE_BADGE_CLASSES_SOFT[selectedConversation.otherMember.role]
                    }`}
                  >
                    {ROLE_LABEL[selectedConversation.otherMember.role]}
                  </span>
                ) : null}
              </div>
              {relatedTask && (
                <button
                  onClick={() => onOpenTaskModal(relatedTask)}
                  className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 transition-colors whitespace-nowrap"
                >
                  <Sparkles className="w-3 h-3" />
                  About: {relatedTask.title}
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {isLoadingMessages && <p className="text-xs text-slate-400 text-center">Loading…</p>}
              {!isLoadingMessages && messages.length === 0 && (
                <p className="text-xs text-slate-400 italic text-center">No messages yet — say hello.</p>
              )}
              {messages.map((m) => {
                const isMe = m.senderId === currentUser.id;
                const isRevealed = revealedMessages[m.id];
                const isConfidential = !!m.isEncrypted;
                return (
                  <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] flex gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                      {!isMe && (
                        <img src={m.senderAvatar} alt={m.senderName} className="w-6 h-6 rounded-full object-cover flex-shrink-0 mt-1" />
                      )}
                      <div>
                        {!isMe && (
                          <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-0.5 px-1">
                            {m.senderName}
                          </p>
                        )}
                        <div
                          className={`px-3 py-2 rounded-2xl text-xs leading-snug ${
                            isMe
                              ? 'bg-blue-600 text-white rounded-tr-sm'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-tl-sm'
                          }`}
                        >
                          {isConfidential && !isRevealed ? (
                            '•••• Confidential message — click Reveal to view ••••'
                          ) : (
                            <>
                              {m.attachmentUrl &&
                                (m.attachmentKind === 'image' ? (
                                  <a href={m.attachmentUrl} target="_blank" rel="noreferrer" className="block mb-1">
                                    <img
                                      src={m.attachmentUrl}
                                      alt={m.attachmentName ?? 'attachment'}
                                      className="max-w-[220px] max-h-[220px] rounded-lg object-cover"
                                    />
                                  </a>
                                ) : (
                                  <a
                                    href={m.attachmentUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg mb-1 ${
                                      isMe ? 'bg-blue-700/60' : 'bg-white dark:bg-slate-700'
                                    }`}
                                  >
                                    <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                                    <span className="truncate underline">{m.attachmentName ?? 'Attachment'}</span>
                                  </a>
                                ))}
                              {m.text}
                            </>
                          )}
                        </div>
                        <div className={`flex items-center gap-2 mt-0.5 px-1 ${isMe ? 'justify-end' : ''}`}>
                          <span className="text-[10px] text-slate-400">{m.timestamp}</span>
                          {isConfidential && (
                            <button
                              type="button"
                              onClick={() => toggleReveal(m.id)}
                              className="text-[10px] font-bold text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-0.5"
                            >
                              {isRevealed ? (
                                <>
                                  <EyeOff className="w-2.5 h-2.5" /> Hide
                                </>
                              ) : (
                                <>
                                  <Eye className="w-2.5 h-2.5" /> Reveal
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            <div className="p-3 border-t border-slate-100 dark:border-slate-800">
              {pendingAttachment && (
                <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-600 dark:text-slate-300 w-fit max-w-full">
                  {pendingAttachment.kind === 'image' ? (
                    <img src={pendingAttachment.url} alt={pendingAttachment.name} className="w-6 h-6 rounded object-cover flex-shrink-0" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                  )}
                  <span className="truncate">{pendingAttachment.name}</span>
                  <button
                    type="button"
                    onClick={() => setPendingAttachment(null)}
                    aria-label="Remove attachment"
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-100 flex-shrink-0"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={chatFileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => handleAttachFile(e.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => chatFileInputRef.current?.click()}
                  disabled={isUploadingAttachment}
                  aria-label="Attach a file"
                  title="Attach a file"
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 flex-shrink-0"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <input
                  id="chat-message-input"
                  type="text"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={isUploadingAttachment ? 'Uploading…' : 'Type a message…'}
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                <label
                  className="flex items-center gap-1 text-[11px] font-medium text-slate-500 cursor-pointer select-none"
                  title="Hides this message behind a 'Reveal' click in the UI — not encrypted, still readable by anyone with database access"
                >
                  <input
                    type="checkbox"
                    checked={messageEncrypted}
                    onChange={(e) => setMessageEncrypted(e.target.checked)}
                    className="rounded text-emerald-600"
                  />
                  <Lock className="w-3 h-3 text-emerald-500" />
                </label>
                <button
                  id="send-chat-message-btn"
                  type="button"
                  onClick={handleSend}
                  disabled={(!messageText.trim() && !pendingAttachment) || isSending || isUploadingAttachment}
                  className="p-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  aria-label="Send message"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* New conversation modal */}
      {isNewConvOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsNewConvOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">New conversation</h3>
              <button
                onClick={() => setIsNewConvOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {canStartGroupChat && (
              <div className="px-4 pt-3 flex gap-2">
                <button
                  onClick={() => setNewConvMode('direct')}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    newConvMode === 'direct'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  Direct message
                </button>
                <button
                  onClick={() => setNewConvMode('group')}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    newConvMode === 'group'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  Group
                </button>
              </div>
            )}

            {newConvMode === 'direct' ? (
              <div className="flex-1 overflow-y-auto p-2">
                {users
                  .filter((u) => u.id !== currentUser.id)
                  .map((u) => (
                    <button
                      key={u.id}
                      disabled={isCreatingConv}
                      onClick={() => handleStartDirect(u.id)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors disabled:opacity-50"
                    >
                      <img src={u.avatar} alt={u.name} className="w-8 h-8 rounded-xl object-cover" />
                      <div className="min-w-0 flex-1 text-left">
                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{u.name}</p>
                        <p className="text-[11px] text-slate-400 truncate">
                          {u.title} · {u.department}
                        </p>
                      </div>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ROLE_BADGE_CLASSES_SOFT[u.role]}`}>
                        {ROLE_LABEL[u.role]}
                      </span>
                    </button>
                  ))}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <input
                  id="new-group-name-input"
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Group name (e.g. Engineering Team)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Members ({groupMemberIds.length} selected)
                </p>
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  {users
                    .filter((u) => u.id !== currentUser.id)
                    .map((u) => {
                      const checked = groupMemberIds.includes(u.id);
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => toggleGroupMember(u.id)}
                          className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                        >
                          <div
                            className={`w-4 h-4 rounded flex items-center justify-center border ${
                              checked
                                ? 'bg-blue-600 border-blue-600'
                                : 'border-slate-300 dark:border-slate-600'
                            }`}
                          >
                            {checked && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <img src={u.avatar} alt={u.name} className="w-6 h-6 rounded-lg object-cover" />
                          <span className="text-xs text-slate-700 dark:text-slate-200 truncate">{u.name}</span>
                        </button>
                      );
                    })}
                </div>
                <button
                  id="create-group-btn"
                  type="button"
                  onClick={handleCreateGroup}
                  disabled={!groupName.trim() || groupMemberIds.length === 0 || isCreatingConv}
                  className="w-full py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {isCreatingConv ? 'Creating…' : 'Create group'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
