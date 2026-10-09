import {
  getOrCreateDevelopmentUser,
  getConversationsForUser,
  getConversationMessages,
} from "./db.js";

async function run() {
  try {
    const user = await getOrCreateDevelopmentUser();

    console.log("Development user:", {
      id: user.id,
      name: user.name,
    });

    const conversations = await getConversationsForUser(user.id);

    console.log("Conversations:", conversations);

    if (conversations.length === 0) {
      console.log("No conversations found");
      process.exit(0);
    }

    const conversationId = conversations[0].id;

    console.log("Testing conversation:", conversationId);

    const messages = await getConversationMessages(
      conversationId,
      user.id,
      50,
    );

    console.log("Messages:", messages);

    process.exit(0);
  } catch (error) {
    console.error("History test failed:", error);
    process.exit(1);
  }
}

run();