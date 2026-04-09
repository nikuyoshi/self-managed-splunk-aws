# HTTPS証明書設定ガイド

## 標準アプローチ: Let's Encrypt + sslip.io

このプロジェクトでは、独自ドメインなしでブラウザ警告のないHTTPSを実現するため、**Let's Encrypt + sslip.io** を標準として採用しています。

### なぜ Let's Encrypt + sslip.io か

- **完全無料**: 証明書もDNSサービスも無償
- **ブラウザ警告なし**: 信頼された認証局による正式な証明書
- **独自ドメイン不要**: Elastic IPアドレスを自動的にドメイン名に変換
- **自動更新**: cronジョブによる90日ごとの自動更新
- **設定済みスクリプト**: `apply-letsencrypt-to-existing.sh` で一括自動適用

### アクセスURL

Elastic IP `203.0.113.10` の場合:
```
https://203-0-113-10.sslip.io:8443
```

## CDKデプロイ時に設定する場合

新規デプロイ時にLet's Encrypt証明書を自動設定できます。

```bash
npx cdk deploy --all \
  --context httpsType=letsencrypt \
  --context letsencryptEmail=your-email@example.com
```

または対話型デプロイで選択:

```bash
npm run deploy:interactive
```

## 既存インスタンスに適用する場合

インスタンスを再作成せずに証明書を適用するには、以下のスクリプトを使用します。

```bash
# インスタンスIDを自動検出して一括適用（推奨）
./scripts/apply-letsencrypt-to-existing.sh \
  --email your-email@example.com \
  --profile <your-aws-profile>
```

詳細は [`docs/enable-https-existing-instances.md`](./enable-https-existing-instances.md) を参照してください。

## 代替: 独自ドメイン + Let's Encrypt

独自ドメインがある場合は、Route 53 と組み合わせることもできます。

### コスト
- ドメイン: $12/年〜
- Route 53: $0.50/月（ホストゾーン）

### 実装例

```bash
# Route 53でAレコード作成後、DNS検証で証明書を取得
certbot certonly --dns-route53 \
  -d splunk.yourdomain.com \
  -d es.yourdomain.com
```

CDKデプロイ時にカスタムドメインを指定することも可能です:

```bash
npx cdk deploy --all \
  --context domainName=splunk.yourdomain.com \
  --context hostedZoneId=<your-route53-zone-id>
```

## 注意事項

- **IPアドレスが変わると証明書の再取得が必要**: Elastic IPを解放・再割り当てした場合は再実行してください
- **Let's Encryptのレート制限**: 同一ドメインに対して7日間で5枚の上限があります
- **ポート80が必要**: 証明書発行時のHTTP-01チャレンジにポート80を一時使用します（スクリプトが自動処理）
