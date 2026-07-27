import type { DeepSeekModel } from "@/domain/deepseek-model";

export function deepSeekModelLabel(model: DeepSeekModel) {
  return model === "deepseek-v4-pro" ? "Pro（更深入）" : "Flash（日常建议）";
}
