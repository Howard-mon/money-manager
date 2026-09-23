# 搭夥帳

手機優先的私人信用卡月帳本。使用 Vue 3、Quasar Dark Mode、Pinia、Vue Router、ECharts、vue-datepicker、Supabase 與 Netlify。全專案使用 JavaScript，元件使用 `<script setup>` 與 scoped SCSS。

## 目前功能

- 電子郵件／密碼登入與註冊
- 按帳單月份記錄、編輯、刪除消費；可記負數退款
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
- 帳號設定：顯示名稱、更改密碼、忘記密碼
- 多本帳本：用邀請連結邀請家人加入，每筆消費可記「誰付的、分給誰」（平均分攤），分帳頁算出誰該給誰多少，按「月結」記為已付款

## 你需要建立的服務

1. **Supabase Free 專案**：以自己的帳號註冊，建立一個新 project。區域建議選靠近台灣的可用區域。請自行妥善保存 Supabase 帳號密碼與資料庫密碼。
2. 在 Supabase 的 **SQL Editor** 依序執行 `supabase/schema.sql`、`supabase/002_shared_ledgers.sql` 、`supabase/003_member_rename.sql` 與 `supabase/004_payment_method.sql`（各執行一次）。會建立資料表、共享帳本、私人 PDF bucket 與 RLS 存取規則。
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
