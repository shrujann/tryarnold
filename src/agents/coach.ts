import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Env } from "../env";
import type { UserRow } from "../db/users";
import { buildRecentContext } from "../services/context";
import { styleChatReply } from "../services/text-style";
import { createChatModel } from "./llm";
import { createCoachTools } from "./tools";

export async function runCoachAgent(
  env: Env,
  db: D1Database,
  user: UserRow,
  text: string,
): Promise<string> {
  const context = await buildRecentContext(db, user);
  const model = createChatModel(env);
  const tools = createCoachTools(env, db, user);

  const agent = createReactAgent({
    llm: model,
    tools,
  });

  const systemPrompt = `You are a concise fitness coach on messaging apps. No emojis. Keep replies short.
Use tools when the user asks about progress, recent meals, or wants to log what they ate.
When the user wants to undo or delete their last meal (e.g. "undo", "delete last meal", "remove that"), call delete_last_meal.
When targets are in CONTEXT, compare today's intake to targets and mention remaining calories/macros when relevant.
Ask clarifying questions when needed.

CONTEXT:
${context}`;

  const result = await agent.invoke({
    messages: [new SystemMessage(systemPrompt), new HumanMessage(text || "(empty message)")],
  });

  const messages = result.messages as Array<{ content?: unknown }>;
  const last = messages[messages.length - 1];
  const content = last?.content;
  const reply =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) =>
              typeof part === "string" ? part : ((part as { text?: string }).text ?? ""),
            )
            .join("")
        : "";

  return styleChatReply(reply);
}
