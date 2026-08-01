# データの出典と取扱い

## 出典

- 提供者: 日本郵便株式会社
- データ: 「住所の郵便番号（1レコード1郵便番号形式・UTF-8）」全国一括
- 配布案内: <https://www.post.japanpost.jp/service/search/zipcode/download/utf-zip.html>
- 説明: <https://www.post.japanpost.jp/service/search/zipcode/download/utf-readme.html>
- 取得元: <https://www.post.japanpost.jp/service/search/zipcode/download/utf/zip/utf_ken_all.zip>
- 現在のデータ更新日: 2026-07-31
- SHA-256: `0b52620fb659846e1893416b333e23154243060325ff1d3d3747b221b915a19d`

日本郵便は郵便番号データに著作権を主張せず、自由な配布を案内しています。利用時は日本郵便の案内と説明を確認してください。本リポジトリでは、再現性と変更監査のため取得した ZIP を `data/source/utf_ken_all.zip` に保持します。

## 変換

`scripts/build_postal.py` は標準ライブラリだけを使い、次を検証・生成します。

1. ZIP に `utf_ken_all.csv` だけが含まれること
2. 15列、7桁郵便番号、12万行以上、11.5万番号以上、47都道府県であること
3. 基準レコード `100-0001 東京都千代田区千代田` があること
4. D1投入用SQL、件数メタデータ、郵便番号別サイトマップ

町域名とカナは元データの値を表示します。「以下に掲載がない場合」などの表記も独自判断で置き換えません。

## 収録外

初期版は、事業所の個別郵便番号、デジタルアドレス、番地、建物名を収録しません。個人運営の非公式サービスであり、日本郵便株式会社との提携関係はありません。
