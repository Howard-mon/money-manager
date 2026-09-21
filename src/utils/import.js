import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'

dayjs.extend(customParseFormat)

// Fields may be separated by spaces (copied from the PDF) or tabs (copied from a table).
const TAISHIN_ROW = /^(\d{3})\/(\d{2})\/(\d{2})\s+\d{3}\/\d{2}\/\d{2}\s+/
const TAISHIN_END = /\s(-?[\d,]+(?:\.\d+)?)(?:\s+[A-Z]{2})?$/

export const CATEGORIES = ['餐飲', '交通', '購物', '生活', '娛樂', '訂閱', '貓咪', '醫療', '其他']

// First match wins, so narrower rules sit above broader ones (小北百貨 is 生活 before 百貨 is 購物).
// Matched against the NFKC form, so full-width ＰＣＨＯＭＥ matches PCHOME.
const CATEGORY_RULES = [
  ['訂閱', /CHATGPT|OPENAI|NETFLIX|APPLE\.COM|SPOTIFY|YOUTUBE|DISNEY/i],
  ['交通', /停車|加油|中油|ETAG|AUTOPASS|USPACE|聯通|捷運|高鐵|台鐵/i],
  ['貓咪', /寵|貓|狗|PET/i],
  ['餐飲', /優步|UBER ?EATS|FOODPANDA|咖啡|COFFEE|茶|飲|餐|火鍋|串燒|星巴克|STARBUCKS|麥當勞/i],
  ['生活', /電話費|電信|電費|水費|瓦斯|美廉社|全聯|家樂福|小北|屈臣氏|康是美/i],
  ['娛樂', /NINTENDO|STEAM|PLAYSTATION|運動中心|健身|電影|威秀/i],
  ['購物', /蝦皮|SHOPEE|PCHOME|MOMO|百貨|LALAPORT|UNIQLO|IKEA|博客來|酷澎|COUPANG/i],
  ['醫療', /診所|醫院|藥局|牙醫/i],
]

export function guessCategory(merchant) {
  const text = merchant.normalize('NFKC')
  return CATEGORY_RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? '其他'
}

export function parsePastedRows(text, billingMonth) {
  if (!text.trim()) return { rows: [], errors: [] }
  if (new RegExp(TAISHIN_ROW.source, 'm').test(text)) return parseTaishinStatement(text, billingMonth)
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length > 301) return { rows: [], errors: ['一次最多匯入 300 筆'] }
  const cells = lines.map((line) => line.split('\t').map((value) => value.trim()))
  const hasHeader = cells[0]?.some((value) => ['日期', '店家', '金額'].includes(value))
  const header = hasHeader ? cells.shift() : ['日期', '店家', '金額', '分類']
  const indexes = ['日期', '店家', '金額', '分類'].map((name) => header.indexOf(name))
  if (indexes.slice(0, 3).some((index) => index < 0)) return { rows: [], errors: ['欄位須包含：日期、店家、金額'] }

  const rows = []
  const errors = []
  cells.forEach((cellsInRow, index) => {
    const [dateIndex, merchantIndex, amountIndex, categoryIndex] = indexes
    const rawDate = cellsInRow[dateIndex]
    const spentAt = dayjs(rawDate, ['YYYY/MM/DD', 'YYYY-MM-DD'], true)
    const merchant = cellsInRow[merchantIndex]?.trim()
    const rawAmount = cellsInRow[amountIndex]?.replace(/[,$NT\s]/g, '')
    const amount = Number(rawAmount)
    if (!spentAt.isValid() || !merchant || !rawAmount || !Number.isFinite(amount) || amount === 0) {
      errors.push(`第 ${index + (hasHeader ? 2 : 1)} 列：日期、店家或金額無效`)
      return
    }
    rows.push({
      spent_at: spentAt.format('YYYY-MM-DD'),
      billing_month: dayjs(billingMonth).startOf('month').format('YYYY-MM-DD'),
      merchant,
      amount,
      category: cellsInRow[categoryIndex] || guessCategory(merchant),
      card_name: null,
      note: null,
      source: 'paste',
    })
  })
  return { rows, errors }
}

// Text copied from a Taishin credit-card PDF: 消費日 入帳起息日 明細 金額 [消費地], dates in ROC years,
// long merchant names wrap onto the next line, and each card's rows follow a "(卡號末四碼:1234)" heading.
// ponytail: a wrapped first line that happens to end in " <number>" is read as complete;
// the leftover line then shows up under skipped, so the preview makes it visible.
export function parseTaishinStatement(text, billingMonth) {
  const rows = []
  const skipped = []
  let card = null
  let pending = null
  for (const line of text.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    if (TAISHIN_ROW.test(line)) {
      if (pending) skipped.push(pending)
      pending = line
    } else if (pending) {
      pending += (/\p{Script=Han}$/u.test(pending) && /^\p{Script=Han}/u.test(line) ? '' : ' ') + line
    } else {
      const last4 = line.match(/卡號末四碼[:：]\s*(\d{4})/)?.[1]
      if (last4) card = `${line.split(/[(（]/)[0].trim()} ${last4}`.slice(0, 50)
      else if (!line.startsWith('消費日')) skipped.push(line)
      continue
    }
    const end = pending.match(TAISHIN_END)
    if (!end) continue
    const record = pending
    pending = null
    const [head, year, month, day] = record.match(TAISHIN_ROW)
    const merchant = record.slice(head.length, end.index).trim().slice(0, 120)
    const amount = Number(end[1].replaceAll(',', ''))
    const spentAt = dayjs(`${Number(year) + 1911}-${month}-${day}`, 'YYYY-MM-DD', true)
    // Paying last month's bill is not spending; record it under 記錄繳款 instead.
    if (!merchant || !amount || !spentAt.isValid() || merchant.includes('卡款')) {
      skipped.push(record)
      continue
    }
    rows.push({
      spent_at: spentAt.format('YYYY-MM-DD'),
      billing_month: dayjs(billingMonth).startOf('month').format('YYYY-MM-DD'),
      merchant,
      amount,
      // A foreign-transaction fee always follows the charge it belongs to, so it shares that category.
      category: merchant.startsWith('國外交易服務費') ? rows.at(-1)?.category ?? '其他' : guessCategory(merchant),
      card_name: card,
      note: null,
      source: 'paste',
    })
  }
  if (pending) skipped.push(pending)
  return { rows, errors: rows.length > 300 ? ['一次最多匯入 300 筆'] : [], skipped }
}
