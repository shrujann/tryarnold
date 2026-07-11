import { HumanMessage } from "@langchain/core/messages";
import type { Env } from "../env";
import { getSettings } from "../config";
import {
  macroEstimateSchema,
  normalizeMacroEstimate,
  strictMacroEstimateSchema,
  type MacroEstimate,
} from "../schemas/nutrition";
import { createChatModel } from "./llm";

export async function applyMealEdit(
  env: Env,
  current: MacroEstimate,
  instruction: string,
): Promise<MacroEstimate> {
  const settings = getSettings(env);
  if (!settings.aiEnabled) {
    return current;
  }

  const model = createChatModel(env).withStructuredOutput(strictMacroEstimateSchema, {
    name: "meal_edit",
    method: "functionCalling",
    strict: true,
  });

  const prompt =
    "Update this meal nutrition estimate based on the user's edit instruction. " +
    "Preserve portion block and weight_g / volume_ml when still accurate. " +
    "Return the full updated estimate JSON.\n\n" +
    `Current estimate:\n${JSON.stringify(current)}\n\n` +
    `User edit: ${instruction}`;

  const result = await model.invoke([new HumanMessage(prompt)]);
  strictMacroEstimateSchema.parse(result);
  return normalizeMacroEstimate(macroEstimateSchema.parse(result));
}
