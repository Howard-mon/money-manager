import { handleEvent } from './lib/handle-event.js'
import { verifySignature } from './lib/signature.js'
import { createStore } from './lib/store.js'

async function reply(replyToken, text, token) {
  const response = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
  })
  if (!response.ok) {
    // LINE explains itself in the body ("Invalid reply token" and friends); the status alone is not enough to debug.
    const detail = await response.text().catch(() => '')
    throw new Error(`LINE reply failed: ${response.status} ${detail.slice(0, 300)}`)
  }
}

export default async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const secret = process.env.LINE_CHANNEL_SECRET
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!secret || !token) {
    console.error('LINE webhook is missing environment variables')
    return new Response('Not configured', { status: 500 })
  }

  // The signature covers the raw bytes, so nothing may parse or rewrite the body before this.
  const raw = await request.text()
  if (!verifySignature(raw, request.headers.get('x-line-signature'), secret)) {
    return new Response('Invalid signature', { status: 401 })
  }

  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return new Response('Invalid body', { status: 400 })
  }

  const events = Array.isArray(body.events) ? body.events : []
  if (!events.length) return new Response('OK') // LINE's "Verify" button sends an empty event list.

  const store = createStore()
  for (const event of events) {
    try {
      const text = await handleEvent(event, { store, now: new Date() })
      // A redelivered event carries a spent reply token, and LINE's verification sends an all-zero one.
      const replyable = event.replyToken && !/^0+$/.test(event.replyToken) && !event.deliveryContext?.isRedelivery
      if (text && replyable) await reply(event.replyToken, text, token)
      else if (text) console.warn('Skipped reply:', event.type, 'redelivery:', Boolean(event.deliveryContext?.isRedelivery))
    } catch (error) {
      // Never log message content, LINE ids or keys.
      console.error('LINE event failed:', error.message, '| event:', event.type, '| redelivery:', Boolean(event.deliveryContext?.isRedelivery))
      if (event.replyToken) await reply(event.replyToken, '系統忙碌中，請稍後再試一次。', token).catch(() => {})
    }
  }
  return new Response('OK')
}
