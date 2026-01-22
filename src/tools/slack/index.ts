// tools/slack/index.ts
import {
  postMessage,
  updateMessage,
  deleteMessage,
  getChannelHistory,
  getThreadReplies,
  listChannels,
  getChannelInfo,
  createChannel,
  inviteToChannel,
  searchMessages,
  getUserInfo,
  listUsers,
  setChannelTopic,
  setChannelPurpose,
  addReaction,
  uploadFile,
} from "./tools-implementation";
import {
  PostMessageSchema,
  UpdateMessageSchema,
  DeleteMessageSchema,
  GetChannelHistorySchema,
  GetThreadRepliesSchema,
  ListChannelsSchema,
  GetChannelInfoSchema,
  CreateChannelSchema,
  InviteToChannelSchema,
  SearchMessagesSchema,
  GetUserInfoSchema,
  ListUsersSchema,
  SetChannelTopicSchema,
  SetChannelPurposeSchema,
  AddReactionSchema,
  UploadFileSchema,
} from "./schemas";

// ── Export the complete tool registry ──────────────────────────────────
export const slackTools = {
  post_message: {
    schema: PostMessageSchema,
    handler: postMessage,
    description: "Post a message to a Slack channel",
  },
  update_message: {
    schema: UpdateMessageSchema,
    handler: updateMessage,
    description: "Update an existing Slack message",
  },
  delete_message: {
    schema: DeleteMessageSchema,
    handler: deleteMessage,
    description: "Delete a Slack message",
  },
  get_channel_history: {
    schema: GetChannelHistorySchema,
    handler: getChannelHistory,
    description: "Get message history from a Slack channel",
  },
  get_thread_replies: {
    schema: GetThreadRepliesSchema,
    handler: getThreadReplies,
    description: "Get replies to a thread in Slack",
  },
  list_channels: {
    schema: ListChannelsSchema,
    handler: listChannels,
    description: "List Slack channels",
  },
  get_channel_info: {
    schema: GetChannelInfoSchema,
    handler: getChannelInfo,
    description: "Get information about a Slack channel",
  },
  create_channel: {
    schema: CreateChannelSchema,
    handler: createChannel,
    description: "Create a new Slack channel",
  },
  invite_to_channel: {
    schema: InviteToChannelSchema,
    handler: inviteToChannel,
    description: "Invite users to a Slack channel",
  },
  search_messages: {
    schema: SearchMessagesSchema,
    handler: searchMessages,
    description: "Search for messages in Slack",
  },
  get_user_info: {
    schema: GetUserInfoSchema,
    handler: getUserInfo,
    description: "Get information about a Slack user",
  },
  list_users: {
    schema: ListUsersSchema,
    handler: listUsers,
    description: "List users in the Slack workspace",
  },
  set_channel_topic: {
    schema: SetChannelTopicSchema,
    handler: setChannelTopic,
    description: "Set the topic for a Slack channel",
  },
  set_channel_purpose: {
    schema: SetChannelPurposeSchema,
    handler: setChannelPurpose,
    description: "Set the purpose for a Slack channel",
  },
  add_reaction: {
    schema: AddReactionSchema,
    handler: addReaction,
    description: "Add a reaction emoji to a Slack message",
  },
  upload_file: {
    schema: UploadFileSchema,
    handler: uploadFile,
    description: "Upload a file to Slack",
  },
} as const;
