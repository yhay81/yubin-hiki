# Metrics

すべての指標は `is_qa = 0` を実利用、`is_qa = 1` を自動確認として分離します。保持期間は35日です。

| event            | 意味                          |
| ---------------- | ----------------------------- |
| `visited`        | 画面を開いた                  |
| `searched`       | 1件以上の結果が出た           |
| `no_result`      | 結果が0件だった               |
| `postal_opened`  | 郵便番号詳細を開いた          |
| `postal_copied`  | 郵便番号をコピーした          |
| `address_copied` | 住所をコピーした              |
| `saved`          | 宛先控えへ保存した            |
| `returned`       | 前回から8時間以上後に再訪した |

イベントには郵便番号、住所、検索語を付加しません。集計は `npm run metrics`、ローカル確認は `npm run metrics -- -Local` です。
