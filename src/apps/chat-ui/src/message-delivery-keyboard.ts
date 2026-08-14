import type { ChatMessageDelivery } from "./api-chat-sessions";

export function adjacentMessageDeliveryChoice(
  currentDelivery: ChatMessageDelivery,
  key: string,
): ChatMessageDelivery | null {
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  return currentDelivery === "queue" ? "steer" : "queue";
}
