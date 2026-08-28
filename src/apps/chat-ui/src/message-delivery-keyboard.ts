import type { ChatMessageDelivery } from "./api-chat-sessions";

type MessageDeliveryKeyboardInput = {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

export function adjacentMessageDeliveryChoice(
  currentDelivery: ChatMessageDelivery,
  input: MessageDeliveryKeyboardInput,
): ChatMessageDelivery | null {
  if (input.altKey || input.ctrlKey || input.metaKey) return null;
  if (input.key !== "ArrowLeft" && input.key !== "ArrowRight") return null;
  return currentDelivery === "queue" ? "steer" : "queue";
}
