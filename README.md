# 搭夥帳

手機優先的私人信用卡月帳本。使用 Vue 3、Quasar Dark Mode、Pinia、Vue Router、ECharts、vue-datepicker、Supabase 與 Netlify。全專案使用 JavaScript，元件使用 `<script setup>` 與 scoped SCSS。

## 目前功能

- 電子郵件／密碼登入與註冊
- 按帳單月份記錄、編輯、刪除消費；可記負數退款
- 採「帳單制」：一頁就是一張帳單，消費日可跨月（分期、上期結轉都留在原始日期）。
  新增消費可選計入上一期／本期／下一期，LINE 加「下期」同理；匯入預覽會顯示消費日區間
- 記錄繳款日期與金額，查看支出、已繳與差額
- 從試算表複製三欄資料貼上，預覽後批次匯入
- 儲存密碼鎖定的 PDF 原檔至私人 Supabase Storage bucket；不解析 PDF
- 分類支出圓餅圖與柱狀圖可切換，下方列出各分類金額與佔比，點分類可篩選明細
- 消費明細可搜尋、依日期／金額／分類排序
- 金額一律為整數新臺幣；分攤以整數元計算，餘數由前面的成員承擔
- 批次匯入可一次指定整批的信用卡暱稱
- 每筆消費可標記信用卡、現金或轉帳；圖示顏色區分（信用卡綠色、現金與轉帳琥珀色），可依付款方式篩選
- 摘要區分總支出與信用卡支出
- 分帳頁點成員可看該成員的明細：每筆他付了多少、分攤多少、淨額從哪裡來
- LINE 機器人記帳：一對一或群組傳「記帳 午餐 120 分帳」即可寫入帳本，支援撤銷
- 帳號設定：顯示名稱、更改密碼、忘記密碼
- 多本帳本：用邀請連結邀請家人加入，每筆消費可記「誰付的、分給誰」（平均分攤），分帳頁算出誰該給誰多少，按「月結」記為已付款

## 你需要建立的服務

1. **Supabase Free 專案**：以自己的帳號註冊，建立一個新 project。區域建議選靠近台灣的可用區域。請自行妥善保存 Supabase 帳號密碼與資料庫密碼。
2. 在 Supabase 的 **SQL Editor** 依序執行 `supabase/schema.sql`、`supabase/002_shared_ledgers.sql` 、`supabase/003_member_rename.sql`、`supabase/004_payment_method.sql` 與 `supabase/005_line_bot.sql`（依編號順序，各執行一次）。會建立資料表、共享帳本、私人 PDF bucket 與 RLS 存取規則。
3. 在 **Project Settings → API** 複製 Project URL 與 publishable key。只使用 publishable key，**不要提供 service_role／secret key、資料庫密碼或 Gmail 密碼**。
4. 在 **Authentication → URL Configuration** 設定 Site URL 為 Netlify 網址；加入本機 `http://localhost:5173/**` 與正式網址作為允許的 redirect URL。註冊信驗證連結要能回到網站。
5. **Netlify Free**：註冊並連接此專案的 Git repository。Build command: `npm run build`；Publish directory: `dist`。在 Site 的 Environment variables 設定 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY`。環境變數變更後重新部署。

## 部署

正式站：<https://savermoney.netlify.app>（Netlify，連結 GitHub `main` 分支自動建置）。

- Build command `npm run build`，Publish directory `dist`，設定在 `netlify.toml`。
- Netlify 的環境變數需設定 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY`；變更後要重新建置才會生效。
- Supabase 的 **Authentication → URL Configuration** 需包含正式網址、分支預覽網址與 `http://localhost:5173/**`。
- Netlify 免費方案不允許從 private repo 自動建置，因此本 repo 為公開。程式碼不含任何金鑰，`.env` 已被忽略。

## 本機執行

```bash
npm install
cp .env.example .env
# 在 .env 內填入 Supabase Project URL 與 publishable key
npm run dev
```

`.env` 已被 Git 忽略。Vite 的 `VITE_` 值會出現在瀏覽器程式中，因此只能放 Supabase 的 publishable key；私密性靠資料表與 Storage 的 RLS 政策保護。

## LINE 記帳機器人

### 需要設定的環境變數

`.env`（本機開發，`netlify dev` 會讀取）與 **Netlify → Project configuration → Environment variables**（正式站）都要設定。這四個變數**沒有** `VITE_` 前綴，只會在 Netlify Function 的伺服器端讀取，不會進入瀏覽器：

```
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

`SUPABASE_URL` 與前端的 `VITE_SUPABASE_URL` 相同；`SUPABASE_SECRET_KEY` 是 Supabase 的 secret／service role key，會繞過 RLS，因此 Function 內部仍自行檢查發訊者、帳本與成員關係。變更環境變數後需重新部署才會生效。

### Webhook URL

```
https://<你的網域>/api/line/webhook
```

由 `netlify.toml` 轉送到 `netlify/functions/line-webhook.js`。該轉送規則必須排在 SPA 的 `/*` 規則之前。

### LINE Developers 設定

在 Messaging API channel 中：

1. **Webhook URL**：填入上方網址後按 **Verify**，應回傳成功（空事件會回 200）。
2. **Use webhook**：開啟。
3. **Webhook redelivery**：可開啟。重送的事件帶有相同的 `webhookEventId`，資料庫的唯一索引會擋下重複記帳。
4. **Allow bot to join group chats**：要在群組使用就必須開啟。
5. 建議關閉 **Auto-reply messages** 與 **Greeting messages**，避免蓋掉機器人的回覆。

### 綁定流程

**個人綁定**（每人一次）

1. 網站 →「帳本設定」→「連結 LINE 記帳機器人」→ 產生個人綁定碼（15 分鐘有效、只能用一次）。
2. 在與機器人的一對一聊天室傳送那組 8 碼。
3. 綁定成功後，一對一聊天室的記帳會記到你當時選取的帳本。

**群組綁定帳本**（每個群組一次，限帳本建立者）

1. 帳本建立者在網站選好帳本與「分帳」預設成員，產生群組綁定碼。
2. 把機器人加進 LINE 群組。
3. 由**產生綁定碼的本人**在群組傳「綁定 ABCD1234」。
4. 群組內成員仍須各自完成個人綁定，且必須是該帳本成員才能記帳；機器人不會自動把人加入帳本。

### 聊天室指令

| 指令 | 說明 |
| --- | --- |
| `記帳 …` | 記一筆消費，群組中也可以 @機器人 後接記帳 |
| `撤銷` | 刪除自己在同一聊天室 10 分鐘內用 LINE 記的最後一筆 |
| `目前帳本` | 顯示目前帳本、成員與「分帳」預設對象 |
| `記帳說明` | 顯示完整格式 |

群組中除了上述指令以外的訊息一律忽略。

### 記帳格式

```
記帳 [日期] 項目 金額 [付款方式] [分攤] [分類] [卡片]
```

- 分隔符號可用空白、半形或全形逗號、頓號或 `|`
- 日期：`今天`、`昨天`、`9/20`、`2026/9/20`，預設今天
- 金額：`1215`、`1,215`、`1215元`，一律四捨五入成整數
- 付款方式：`信用卡`、`現金`、`轉帳`，預設信用卡
- 分類：`分類:訂閱` 或 `#訂閱`，未指定時沿用網站的 `guessCategory`
- 卡片：`卡片:台新`
- 付款人：預設為發訊者，`Elly付` 依帳本成員的顯示名稱指定
- 分攤：`分帳`（群組預設成員）、`全部平分`、`Howard Elly平分`，未指定時只算付款人
- 成員名稱找不到或重複時不會寫入，機器人會回覆請你修正

## 台新信用卡帳單匯入

在 PDF 帳單反白明細表，複製後貼到「貼上帳單」即可，系統會自動辨識：民國年日期、跨行的店家名稱、退款與卡別（例如 `Richart卡 1234`）都會處理。繳上期卡款與沒有日期的列（例如循環信用利息）會列在「略過」，不會匯入。匯入前先把帳單月份切到對應月份。

## 試算表匯入格式

複製以下三欄並貼到「貼上帳單」，可加一欄「分類」。日期接受 `YYYY/MM/DD` 或 `YYYY-MM-DD`。每次最多 300 筆；匯入前務必檢查帳單月份，重複匯入會產生重複資料。

```text
日期	店家	金額
2026/09/01	早餐	85
2026/09/02	退款	-120
```

## 帳單與資料安全

「忘記密碼」寄出的重設信同樣受限於寄信服務：Supabase 內建寄信服務只寄給專案團隊成員，家人收不到註冊驗證信，因此本專案已在 **Authentication → Sign In / Providers** 關閉 Confirm email。家人都註冊完成後，建議關閉 **Allow new users to sign up**。

邀請連結等同帳本鑰匙，拿到的人登入後即可加入；只傳給信任的人。PDF 帳單不會跟著帳本共享，只有上傳者看得到。

PDF 只作為原檔備份。密碼鎖定的內容不會自動讀取；請不要將帳單密碼貼到程式碼或對話。
