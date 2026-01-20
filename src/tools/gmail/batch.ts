import { z } from "zod";
import { GmailTool } from "./types";
import { BatchModifyEmailsSchema, BatchDeleteEmailsSchema } from "./schemas";

async function processBatches<T>(
  items: T[],
  batchSize: number,
  fn: (batch: T[]) => Promise<void>,
): Promise<{ success: number; failed: { item: T; error: string }[] }> {
  const failed: { item: T; error: string }[] = [];
  let success = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    try {
      await fn(batch);
      success += batch.length;
    } catch (err: any) {
      for (const item of batch) {
        try {
          await fn([item]);
          success++;
        } catch (e: any) {
          failed.push({ item, error: e.message });
        }
      }
    }
  }

  return { success, failed };
}

export const batchModifyEmails: GmailTool<z.infer<typeof BatchModifyEmailsSchema>> = async ({ gmail }, args) => {
  const { messageIds, addLabelIds, removeLabelIds, batchSize } = args;
  const body: any = {};
  if (addLabelIds?.length) body.addLabelIds = addLabelIds;
  if (removeLabelIds?.length) body.removeLabelIds = removeLabelIds;

  if (Object.keys(body).length === 0) {
    return { content: [{ type: "text", text: "No label changes specified" }] };
  }

  const { success, failed } = await processBatches(messageIds, batchSize, async (batch) => {
    await Promise.all(
      batch.map((id) =>
        gmail.users.messages.modify({
          userId: "me",
          id,
          requestBody: body,
        }),
      ),
    );
  });

  let text = `Batch label update complete.\nSuccessfully processed: ${success} emails\n`;
  if (failed.length) {
    text += `Failed: ${failed.length} emails\n\nFailed IDs:\n${failed
      .map((f) => `- ${String(f.item).slice(0, 12)}... (${f.error})`)
      .join("\n")}`;
  }

  return { content: [{ type: "text", text }] };
};

export const batchDeleteEmails: GmailTool<z.infer<typeof BatchDeleteEmailsSchema>> = async ({ gmail }, { messageIds, batchSize }) => {
  const { success, failed } = await processBatches(messageIds, batchSize, async (batch) => {
    await Promise.all(
      batch.map((id) =>
        gmail.users.messages.delete({
          userId: "me",
          id,
        }),
      ),
    );
  });

  let text = `Batch delete complete.\nSuccessfully deleted: ${success} emails\n`;
  if (failed.length) {
    text += `Failed: ${failed.length} emails\n\nFailed IDs:\n${failed
      .map((f) => `- ${String(f.item).slice(0, 12)}... (${f.error})`)
      .join("\n")}`;
  }

  return { content: [{ type: "text", text }] };
};
