import {
  getOrCreateDevelopmentUser,
  createConversation,
  saveMessage,
} from './db.js'

async function run() {
  try {
    const user = await getOrCreateDevelopmentUser()

    console.log('Development user:', {
      id: user.id,
      name: user.name,
    })

    const conversation = await createConversation({
      userId: user.id,
      mode: 'text',
      title: 'Message saving test',
    })

    console.log('Conversation created:', conversation)

    const userMessage = await saveMessage({
      conversationId: conversation.id,
      role: 'user',
      content: 'Hello Alex, I am learning English.',
      messageType: 'text',
    })

    console.log('User message saved:', userMessage)

    const alexMessage = await saveMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: 'That is great. What would you like to practice today?',
      messageType: 'text',
    })

    console.log('Alex message saved:', alexMessage)

    process.exit(0)
  } catch (error) {
    console.error('Message saving test failed:', error)
    process.exit(1)
  }
}

run()