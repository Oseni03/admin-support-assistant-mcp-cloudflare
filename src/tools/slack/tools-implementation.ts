// tools/slack/tools-implementation.ts
import { z } from "zod";
import { SlackTool } from "./types";
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

export const postMessage: SlackTool<z.infer<typeof PostMessageSchema>> = async ({ slack }, args) => {
  const options: any = {
    channel: args.channel,
    text: args.text,
  };

  if (args.threadTs) {
    options.thread_ts = args.threadTs;
  }

  if (args.blocks) {
    try {
      options.blocks = JSON.parse(args.blocks);
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error parsing blocks: ${e}` }],
      };
    }
  }

  const response = await slack.chat.postMessage(options);

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const updateMessage: SlackTool<z.infer<typeof UpdateMessageSchema>> = async ({ slack }, args) => {
  const options: any = {
    channel: args.channel,
    ts: args.ts,
    text: args.text,
  };

  if (args.blocks) {
    try {
      options.blocks = JSON.parse(args.blocks);
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error parsing blocks: ${e}` }],
      };
    }
  }

  const response = await slack.chat.update(options);

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const deleteMessage: SlackTool<z.infer<typeof DeleteMessageSchema>> = async ({ slack }, args) => {
  const response = await slack.chat.delete({
    channel: args.channel,
    ts: args.ts,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const getChannelHistory: SlackTool<z.infer<typeof GetChannelHistorySchema>> = async ({ slack }, args) => {
  const options: any = {
    channel: args.channel,
    limit: args.limit,
  };

  if (args.oldest) options.oldest = args.oldest;
  if (args.latest) options.latest = args.latest;

  const response = await slack.conversations.history(options);

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const getThreadReplies: SlackTool<z.infer<typeof GetThreadRepliesSchema>> = async ({ slack }, args) => {
  const response = await slack.conversations.replies({
    channel: args.channel,
    ts: args.ts,
    limit: args.limit,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const listChannels: SlackTool<z.infer<typeof ListChannelsSchema>> = async ({ slack }, args) => {
  const response = await slack.conversations.list({
    types: args.types,
    limit: args.limit,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const getChannelInfo: SlackTool<z.infer<typeof GetChannelInfoSchema>> = async ({ slack }, args) => {
  const response = await slack.conversations.info({
    channel: args.channel,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const createChannel: SlackTool<z.infer<typeof CreateChannelSchema>> = async ({ slack }, args) => {
  const response = await slack.conversations.create({
    name: args.name,
    is_private: args.isPrivate,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const inviteToChannel: SlackTool<z.infer<typeof InviteToChannelSchema>> = async ({ slack }, args) => {
  const response = await slack.conversations.invite({
    channel: args.channel,
    users: args.users.join(","),
  });

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const searchMessages: SlackTool<z.infer<typeof SearchMessagesSchema>> = async ({ slack }, args) => {
  const response = await slack.search.messages({
    query: args.query,
    count: args.count,
    sort: args.sort,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const getUserInfo: SlackTool<z.infer<typeof GetUserInfoSchema>> = async ({ slack }, args) => {
  const response = await slack.users.info({
    user: args.user,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const listUsers: SlackTool<z.infer<typeof ListUsersSchema>> = async ({ slack }, args) => {
  const response = await slack.users.list({
    limit: args.limit,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const setChannelTopic: SlackTool<z.infer<typeof SetChannelTopicSchema>> = async ({ slack }, args) => {
  const response = await slack.conversations.setTopic({
    channel: args.channel,
    topic: args.topic,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const setChannelPurpose: SlackTool<z.infer<typeof SetChannelPurposeSchema>> = async ({ slack }, args) => {
  const response = await slack.conversations.setPurpose({
    channel: args.channel,
    purpose: args.purpose,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const addReaction: SlackTool<z.infer<typeof AddReactionSchema>> = async ({ slack }, args) => {
  const response = await slack.reactions.add({
    channel: args.channel,
    timestamp: args.timestamp,
    name: args.name,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const uploadFile: SlackTool<z.infer<typeof UploadFileSchema>> = async ({ slack }, args) => {
  const options: any = {
    channels: args.channels.join(","),
    content: args.content,
    filename: args.filename,
  };

  if (args.title) options.title = args.title;
  if (args.initialComment) options.initial_comment = args.initialComment;

  const response = await slack.files.uploadV2(options);

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};
