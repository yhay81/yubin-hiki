# 郵便引き

郵便番号から住所へ、住所・カナから郵便番号へ引ける、日本語の宛名検索です。

- 公開先: <https://yubin-hiki.yhay81.com>
- データ: 日本郵便「住所の郵便番号（1レコード1郵便番号形式・UTF-8）」全国一括
- 構成: Cloudflare Workers / Hono JSX / Vite+ / D1
- 利用者登録: なし。宛先控えはブラウザ内だけに保存

## 開発

Node.js 24 と npm 11 を使用します。

```powershell
npm install
npm run postal:verify
npx wrangler d1 migrations apply yubin-hiki --local
pwsh -NoLogo -NoProfile -File ops/import-postal.ps1 -Local
npm run dev
```

品質確認は `npm run release:check`、`npm run check`、`npm test`、`npm run build` の順です。公式データを更新するときは `npm run postal:refresh` を実行し、生成差分と件数をレビューします。

## 境界

初期版は一般の住所郵便番号だけを対象にします。事業所の個別郵便番号、デジタルアドレス、番地・建物名は含みません。郵便引きは個人運営の非公式サービスで、日本郵便株式会社による提供・監修・推奨を受けていません。

コードは MIT License です。郵便番号データの取扱いは [SOURCE.md](SOURCE.md) を参照してください。
