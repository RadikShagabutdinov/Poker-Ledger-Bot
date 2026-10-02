// Business logic shared by the bot and the HTTP API (SPEC §9.4).
export { touchActor, type Actor } from './context';
export {
  DEFAULT_TIME_ZONE,
  type Membership,
  type MembershipChecker,
  type MessageUpdater,
  type ServiceDeps,
} from './deps';
export { ServiceError } from './errors';
export {
  CHAT_DEFAULTS,
  findChatByTelegramId,
  getChat,
  migrateChat,
  registerChat,
  setBotStatus,
  updateChatSettings,
  type ChatView,
  type RegisterChatInput,
} from './chats';
export { addGuest, listPlayers, renamePlayer, type PlayerView } from './players';
export {
  getProfile,
  listMyChats,
  updateProfile,
  type MyChatView,
  type ProfileView,
} from './profile';
export {
  addPlayerToGame,
  assertCanHaveAnotherActiveGame,
  createGame,
  listActiveGames,
  renderGameName,
  updateGame,
  type AddGamePlayerInput,
  type CreateGameInput,
  type UpdateGameInput,
} from './games';
export {
  UNDO_MINE_WINDOW_MS,
  buySelf,
  cancelEvent,
  recordBuy,
  recordCashOut,
  undoLast,
  type CancelledEvent,
  type RecordedEvent,
} from './events';
export { getGameLog, getGameState, type GameState, type LogEntry } from './state';
export {
  loadGameMessageData,
  setResultMessageId,
  setStatusMessageId,
  userLanguage,
  type GameMessageData,
} from './messages';
export { finishGame, previewFinish, type FinishInput, type FinishPreview } from './finish';
export {
  getSettlement,
  resetSettlement,
  saveSettlement,
  type PaymentDetails,
  type SettlementView,
} from './settlement';
export {
  cancelGameEvent,
  editFinishedEvents,
  recordGameEvent,
  updateFinishedMismatch,
  type FinishedEventsEdit,
  type GameEventInput,
} from './finishedEdit';
export { deleteGame, reopenGame } from './lifecycle';
export {
  HISTORY_PAGE_SIZE,
  getGameDetails,
  listGames,
  type GameDetails,
  type HistoryItem,
  type HistoryPage,
  type HistoryQuery,
} from './history';
export type { SettlementPolicy } from './results';
