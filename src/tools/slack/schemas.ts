import { z } from "zod";

export const PostMessageSchema = z.object({
  channel: z.string().describe("Channel ID or name (e.g., 'C1234567890' or '#general')"),
  text: z.string().describe("Message text"),
  threadTs: z.string().optional().describe("Thread timestamp to reply to"),
  blocks: z.string().optional().describe("JSON string of Block Kit blocks"),
});

export const UpdateMessageSchema = z.object({
  channel: z.string().describe("Channel ID where the message is"),
  ts: z.string().describe("Timestamp of the message to update"),
  text: z.string().describe("New message text"),
  blocks: z.string().optional().describe("JSON string of Block Kit blocks"),
});

export const DeleteMessageSchema = z.object({
  channel: z.string().describe("Channel ID where the message is"),
  ts: z.string().describe("Timestamp of the message to delete"),
});

export const GetChannelHistorySchema = z.object({
  channel: z.string().describe("Channel ID"),
  limit: z.number().optional().default(10).describe("Number of messages to retrieve (max 100)"),
  oldest: z.string().optional().describe("Start of time range (timestamp)"),
  latest: z.string().optional().describe("End of time range (timestamp)"),
});

export const GetThreadRepliesSchema = z.object({
  channel: z.string().describe("Channel ID"),
  ts: z.string().describe("Thread parent message timestamp"),
  limit: z.number().optional().default(10).describe("Number of replies to retrieve"),
});

export const ListChannelsSchema = z.object({
  types: z.string().optional().default("public_channel,private_channel").describe("Comma-separated channel types"),
  limit: z.number().optional().default(20).describe("Number of channels to retrieve"),
});

export const GetChannelInfoSchema = z.object({
  channel: z.string().describe("Channel ID"),
});

export const CreateChannelSchema = z.object({
  name: z.string().describe("Channel name (lowercase, no spaces)"),
  isPrivate: z.boolean().optional().default(false).describe("Whether the channel is private"),
});

export const InviteToChannelSchema = z.object({
  channel: z.string().describe("Channel ID"),
  users: z.array(z.string()).describe("Array of user IDs to invite"),
});

export const SearchMessagesSchema = z.object({
  query: z.string().describe("Search query"),
  count: z.number().optional().default(20).describe("Number of results to return"),
  sort: z.enum(["score", "timestamp"]).optional().default("score").describe("Sort order"),
});

export const GetUserInfoSchema = z.object({
  user: z.string().describe("User ID"),
});

export const ListUsersSchema = z.object({
  limit: z.number().optional().default(20).describe("Number of users to retrieve"),
});

export const SetChannelTopicSchema = z.object({
  channel: z.string().describe("Channel ID"),
  topic: z.string().describe("New channel topic"),
});

export const SetChannelPurposeSchema = z.object({
  channel: z.string().describe("Channel ID"),
  purpose: z.string().describe("New channel purpose"),
});

export const AddReactionSchema = z.object({
  channel: z.string().describe("Channel ID"),
  timestamp: z.string().describe("Message timestamp"),
  name: z.string().describe("Reaction emoji name (e.g., 'thumbsup')"),
});

export const UploadFileSchema = z.object({
  channels: z.array(z.string()).describe("Array of channel IDs to share the file in"),
  content: z.string().describe("File content (text or base64 for binary)"),
  filename: z.string().describe("Filename"),
  title: z.string().optional().describe("File title"),
  initialComment: z.string().optional().describe("Initial comment about the file"),
});
