import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePastedRows } from '../src/utils/import.js'

test('貼上帳單會保留退款並拒絕不存在的日期', () => {
  const input = '日期\t店家\t金額\n2026/09/01\t早餐\t85\n2026/09/02\t退款\t-120'
  const result = parsePastedRows(input, '2026-10-01')
  assert.equal(result.errors.length, 0)
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[1].amount, -120)
  assert.equal(result.rows[0].billing_month, '2026-10-01')
  assert.equal(parsePastedRows('日期\t店家\t金額\n2026/02/30\t錯誤\t10', '2026-02-01').errors.length, 1)
})

test('台新 PDF 複製的明細：民國年、換行店家、退款、卡別，略過繳款與無日期列', () => {
  const input = [
    '消費日 入帳起息日 消費明細 新臺幣金額 外幣折算日 消費地 幣 別 外幣金額',
    '115/08/24 115/08/24 台新銀行帳戶自動轉帳扣繳台新信用',
    '卡款 -62,653',
    '循環信用利息 135',
    'Richart卡(原太陽悠遊晶緻) (卡號末四碼:0000)',
    '115/08/10 115/08/14 OPENAI *CHATGPT SUBSCR000000 690 US',
    '115/08/10 115/08/14 國外交易服務費－690.00 10',
    '115/08/13 115/08/20 台北市停車費退費M-NA***000-',
    '00000 -20 TW',
    '115/08/28 115/08/31 繳交１１５年０８月份電話費',
    'Y0***00 1,419 TW',
  ].join('\n')
  const { rows, errors, skipped } = parsePastedRows(input, '2026-08-01')
  assert.deepEqual(errors, [])
  assert.deepEqual(rows.map((row) => [row.spent_at, row.merchant, row.amount]), [
    ['2026-08-10', 'OPENAI *CHATGPT SUBSCR000000', 690],
    ['2026-08-10', '國外交易服務費－690.00', 10],
    ['2026-08-13', '台北市停車費退費M-NA***000- 00000', -20],
    ['2026-08-28', '繳交１１５年０８月份電話費 Y0***00', 1419],
  ])
  assert.equal(rows[0].card_name, 'Richart卡 0000')
  assert.deepEqual(skipped, ['115/08/24 115/08/24 台新銀行帳戶自動轉帳扣繳台新信用卡款 -62,653', '循環信用利息 135'])
})

test('依店家自動分類；全形字、Tab 分隔都能辨識，國外手續費跟著前一筆', () => {
  const input = [
    '台新商務卡 (卡號末四碼:0000)',
    '消費日\t入帳起息日\t消費明細\t新臺幣金額\t消費地',
    '115/05/31\t115/09/03\tＰＣＨＯＭＥ１ 第04/06期 /TW\t4,265\tTW',
    '115/08/20\t115/08/21\tAPPLE.COM/BILL000000\t130\tIE',
    '115/08/20\t115/08/21\t國外交易服務費－130.00\t2',
    '115/08/23\t115/08/27\t愛貓園A0000 Taipei\t2,741\tTW',
    '115/09/01\t115/09/04\t小北百貨－汐止店A0000 HSINPE\t79\tTW',
    '115/08/30\t115/09/02\t遠東百貨股份有限公司信義分公司 TAIPEI\t1,232\tTW',
    '115/08/30\t115/09/02\tＡｕｔｏｐａｓｓ－Ｓｔｒｅ TAIPEI\t57',
    '115/08/09\t115/08/10\t連加＊連加＊特麗樹工坊TAIPEI\t215\tTW',
  ].join('\n')
  const { rows, skipped } = parsePastedRows(input, '2026-08-01')
  assert.deepEqual(skipped, [])
  assert.deepEqual(rows.map((row) => [row.amount, row.category]), [
    [4265, '購物'], [130, '訂閱'], [2, '訂閱'], [2741, '貓咪'], [79, '生活'], [1232, '購物'], [57, '交通'], [215, '其他'],
  ])
  assert.equal(rows[0].spent_at, '2026-05-31')
  assert.equal(rows[0].card_name, '台新商務卡 0000')
})
