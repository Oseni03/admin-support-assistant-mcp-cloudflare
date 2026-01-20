import { sendEmail } from "./send-email";
import { draftEmail } from "./draft-email";
import { readEmail } from "./read-email";
import { searchEmails } from "./search-emails";
import { modifyEmail } from "./modify-email";
import { deleteEmail } from "./delete-email";
import { listEmailLabels } from "./labels";
import { createLabel } from "./labels";
import { updateLabel } from "./labels";
import { deleteLabel } from "./labels";
import { getOrCreateLabel } from "./labels";
import { batchModifyEmails } from "./batch";
import { batchDeleteEmails } from "./batch";
import {
  BatchDeleteEmailsSchema,
  BatchModifyEmailsSchema,
  CreateLabelSchema,
  DeleteEmailSchema,
  DeleteLabelSchema,
  GetOrCreateLabelSchema,
  ListEmailLabelsSchema,
  ModifyEmailSchema,
  ReadEmailSchema,
  SearchEmailsSchema,
  SendEmailSchema,
  UpdateLabelSchema,
} from "./schemas";

// ── Export the complete tool registry ──────────────────────────────────
export const gmailTools = {
  send_email: {
    schema: SendEmailSchema,
    handler: sendEmail,
    description: "Send a new email via Gmail",
  },
  draft_email: {
    schema: SendEmailSchema,
    handler: draftEmail,
    description: "Create a draft email in Gmail",
  },
  read_email: {
    schema: ReadEmailSchema,
    handler: readEmail,
    description: "Retrieve the full content of a specific email",
  },
  search_emails: {
    schema: SearchEmailsSchema,
    handler: searchEmails,
    description: "Search for emails using Gmail search syntax",
  },
  modify_email: {
    schema: ModifyEmailSchema,
    handler: modifyEmail,
    description: "Modify labels (move to folders, archive, etc.)",
  },
  delete_email: {
    schema: DeleteEmailSchema,
    handler: deleteEmail,
    description: "Permanently delete an email",
  },
  list_email_labels: {
    schema: ListEmailLabelsSchema,
    handler: listEmailLabels,
    description: "List all Gmail labels (system + user)",
  },
  create_label: {
    schema: CreateLabelSchema,
    handler: createLabel,
    description: "Create a new Gmail label",
  },
  update_label: {
    schema: UpdateLabelSchema,
    handler: updateLabel,
    description: "Update an existing Gmail label",
  },
  delete_label: {
    schema: DeleteLabelSchema,
    handler: deleteLabel,
    description: "Delete a Gmail label",
  },
  get_or_create_label: {
    schema: GetOrCreateLabelSchema,
    handler: getOrCreateLabel,
    description: "Get an existing label or create it if it doesn't exist",
  },
  batch_modify_emails: {
    schema: BatchModifyEmailsSchema,
    handler: batchModifyEmails,
    description: "Batch modify labels on multiple emails",
  },
  batch_delete_emails: {
    schema: BatchDeleteEmailsSchema,
    handler: batchDeleteEmails,
    description: "Batch permanently delete multiple emails",
  },
} as const;
